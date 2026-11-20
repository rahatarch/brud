import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import * as Protocol from '@brud/protocol';
import type {
  DaemonCallerTier,
  DaemonHandshakeResult,
  DaemonInfoResult,
  DaemonPingResult,
  JsonRpcId,
  KernelBootResult,
  KernelDisposeResult,
  KernelInstanceDescriptor,
  KernelKindsResult,
  KernelListResult,
  KernelRequirementsResult,
  KernelRouteResult,
  KernelStatusResult,
  RpcErrorDetails,
  RpcRequest,
  RpcResponse,
  RpcSuccessResponse,
} from '@brud/protocol';
import {
  BootOptionNotAllowedError,
  KernelInstanceNotFoundError,
  loadKernelModule,
} from '../instanceRegistry.js';
import type { KernelInstance, KernelInstanceRegistry } from '../instanceRegistry.js';
import { ConnectValidator } from './handshake.js';
import { createRpcErrorResponse, toRpcErrorResponse } from './wireErrors.js';
import * as DaemonVersion from '../version.js';

export interface DispatchSession {
  readonly connectionId: string;
  readonly handshaken: boolean;
  /**
   * Caller principal fixed by the authenticated handshake. Undefined only
   * before the secure channel has established a session.
   */
  tier: DaemonCallerTier | undefined;
  markHandshaken(): void;
}

export interface DispatchOptions {
  /** Cancellation signal owned by the transport connection. */
  readonly signal?: AbortSignal;
}

export interface RequestDispatcherOptions {
  /** The daemon's kernels. */
  readonly registry: KernelInstanceRegistry;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

/** Caller id the daemon presents to the kernel when opening a host session. */
const HOST_CALLER_ID = 'brud.host.daemon';

/** Route surface the Router (hardcore) exposes as `syntax.route@1`. */
interface SyntaxRoute {
  route(text: string, options?: Record<string, unknown>): Promise<unknown>;
  kinds(): readonly unknown[];
}

class MethodError extends Error {
  readonly rpcCode: Protocol.RpcErrorCode;

  readonly details: RpcErrorDetails | undefined;

  constructor(rpcCode: Protocol.RpcErrorCode, message: string, details?: RpcErrorDetails) {
    super(message);
    this.name = 'MethodError';
    this.rpcCode = rpcCode;
    this.details = details;
  }
}

function asParams(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MethodError(Protocol.INVALID_PARAMS, 'Params must be an object');
  }

  return value as Record<string, unknown>;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new MethodError(Protocol.INVALID_PARAMS, `${key} must be a non-empty string`, { field: key });
  }

  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new MethodError(Protocol.INVALID_PARAMS, `${key} must be a string`, { field: key });
  }

  return value;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];

  if (value !== undefined && typeof value !== 'boolean') {
    throw new MethodError(Protocol.INVALID_PARAMS, `${key} must be a boolean`, { field: key });
  }

  return value as boolean | undefined;
}

/** Plain JSON copy: nothing but data crosses the wire. */
function toJson<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function describe(instance: KernelInstance): KernelInstanceDescriptor {
  return {
    instanceId: instance.id,
    state: instance.state,
    clientCount: instance.clients.size,
    lastUsedAt: instance.lastUsedAt.toISOString(),
  };
}

/**
 * Routes daemon RPC. The dispatcher knows the kernel and nothing above it:
 * remote work is Brud syntax handed to the Router inside a host session whose
 * capabilities the operator assigned to the authenticated principal.
 */
export class RequestDispatcher {
  private readonly registry: KernelInstanceRegistry;

  private readonly connectValidator = new ConnectValidator();

  private readonly serverName: string;

  private readonly serverVersion: string;

  private readonly startedAt: number = Date.now();

  constructor(options: RequestDispatcherOptions) {
    this.registry = options.registry;
    this.serverName = options.serverName ?? DaemonVersion.DAEMON_SERVER_NAME;
    this.serverVersion = options.serverVersion ?? DaemonVersion.DAEMON_SERVER_VERSION;
  }

  /** Detaches a closed connection from every kernel it used. */
  connectionClosed(connectionId: string): void {
    this.registry.detachClient(connectionId);
  }

  async dispatch(request: RpcRequest, session: DispatchSession, options: DispatchOptions = {}): Promise<RpcResponse> {
    try {
      return await this.route(request, session, options);
    } catch (error: unknown) {
      if (error instanceof MethodError) {
        return createRpcErrorResponse(request.id, error.rpcCode, error.message, error.details);
      }

      if (error instanceof KernelInstanceNotFoundError) {
        return createRpcErrorResponse(request.id, Protocol.INVALID_PARAMS, error.message, {
          errorCode: error.code,
          instanceId: error.instanceId,
        });
      }

      if (error instanceof BootOptionNotAllowedError) {
        return createRpcErrorResponse(request.id, Protocol.INVALID_PARAMS, error.message, {
          errorCode: error.code,
          field: error.field,
        });
      }

      return toRpcErrorResponse(request.id, error);
    }
  }

  private async route(request: RpcRequest, session: DispatchSession, options: DispatchOptions): Promise<RpcResponse> {
    if (request.method === Protocol.DAEMON_CONNECT) {
      return success(request.id, this.connect(request.params, session));
    }

    if (!session.handshaken) {
      throw new MethodError(
        Protocol.HANDSHAKE_REQUIRED,
        `Method "${request.method}" requires a completed daemon handshake`,
        { method: request.method },
      );
    }

    const params = asParams(request.params);

    switch (request.method) {
      case Protocol.DAEMON_PING:
        return success(request.id, this.ping(params, session));
      case Protocol.DAEMON_INFO:
        return success(request.id, this.info(session));
      case Protocol.KERNEL_REQUIREMENTS:
        return success(request.id, await this.requirements());
      case Protocol.KERNEL_BOOT:
        return success(request.id, await this.boot(params, session));
      case Protocol.KERNEL_ATTACH:
        return success(request.id, this.attach(params, session));
      case Protocol.KERNEL_LIST:
        return success(request.id, this.list(session));
      case Protocol.KERNEL_STATUS:
        return success(request.id, this.status(params, session));
      case Protocol.KERNEL_DISPOSE:
        return success(request.id, await this.dispose(params, session));
      case Protocol.KERNEL_KINDS:
        return success(request.id, await this.kinds(params, session));
      case Protocol.KERNEL_ROUTE:
        return success(request.id, await this.routeText(params, session, options.signal));
      default:
        throw new MethodError(Protocol.METHOD_NOT_FOUND, `Unknown method "${request.method}"`, { method: request.method });
    }
  }

  private connect(value: unknown, session: DispatchSession): DaemonHandshakeResult {
    if (session.handshaken) {
      throw new MethodError(Protocol.ALREADY_HANDSHAKEN, 'This connection has already completed the daemon handshake');
    }

    const outcome = this.connectValidator.validate(value);

    if (!outcome.ok) {
      throw new MethodError(outcome.code, outcome.message, outcome.data);
    }

    const tier = session.tier;

    if (tier === undefined) {
      throw new MethodError(Protocol.INTERNAL_ERROR, 'The connection has no authenticated principal');
    }

    session.markHandshaken();

    return {
      connectionId: session.connectionId,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      tier,
      capabilities: {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        methods: [...Protocol.DAEMON_METHODS, ...Protocol.KERNEL_METHODS, ...Protocol.REQUEST_METHODS],
      },
      server: { name: this.serverName, version: this.serverVersion, pid: process.pid },
    };
  }

  private ping(params: Record<string, unknown>, session: DispatchSession): DaemonPingResult {
    const nonce = optionalString(params, 'nonce');

    return {
      connectionId: session.connectionId,
      timestamp: Date.now(),
      ...(nonce === undefined ? {} : { nonce }),
    };
  }

  private info(session: DispatchSession): DaemonInfoResult {
    return {
      connectionId: session.connectionId,
      name: this.serverName,
      version: this.serverVersion,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  private async requirements(): Promise<KernelRequirementsResult> {
    const fields = await this.registry.requirements();
    const settable = this.registry.clientSettableFields;

    return { fields: fields.map((field) => ({ ...field, clientSettable: settable.includes(field.name) })) };
  }

  private async boot(params: Record<string, unknown>, session: DispatchSession): Promise<KernelBootResult> {
    const options = params.options ?? {};

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new MethodError(Protocol.INVALID_PARAMS, 'options must be an object', { field: 'options' });
    }

    const { instance, reused } = await this.registry.boot(toJson(options), session.connectionId);

    return { instance: describe(instance), reused, pruned: toJson(instance.pruned) };
  }

  private attach(params: Record<string, unknown>, session: DispatchSession): KernelStatusResult {
    return { instance: describe(this.registry.attach(requireString(params, 'instanceId'), session.connectionId)) };
  }

  private list(session: DispatchSession): KernelListResult {
    return { instances: this.registry.listFor(session.connectionId).map(describe) };
  }

  private status(params: Record<string, unknown>, session: DispatchSession): KernelStatusResult {
    const instanceId = requireString(params, 'instanceId');

    try {
      return { instance: describe(this.registry.forClient(instanceId, session.connectionId)) };
    } catch (error: unknown) {
      if (error instanceof KernelInstanceNotFoundError) {
        return { instance: null };
      }

      throw error;
    }
  }

  private async dispose(params: Record<string, unknown>, session: DispatchSession): Promise<KernelDisposeResult> {
    const instance = this.registry.forClient(requireString(params, 'instanceId'), session.connectionId);

    return { disposed: await this.registry.dispose(instance.id) };
  }

  /** Runs `operation` against the Router inside the session's host call. */
  private async inHostSession<T>(
    kernel: BrudKernel,
    session: DispatchSession,
    operation: (syntax: SyntaxRoute) => Promise<T> | T,
  ): Promise<T> {
    const kernelModule = await loadKernelModule();
    const capabilities = this.registry.capabilitiesFor(session.tier ?? 'ai');

    return kernel.runHostCall({ capabilities }, async () => {
      const registry = kernel.requestAccess(
        { callerId: HOST_CALLER_ID, tier: 'core', options: {} },
        kernelModule.ExposedApiRegistryToken,
      );
      const syntax = registry.resolve<SyntaxRoute>('syntax.route');

      if (syntax === null) {
        throw new MethodError(Protocol.INTERNAL_ERROR, 'The kernel has no Router (syntax.route@1)');
      }

      return operation(syntax);
    });
  }

  private async kinds(params: Record<string, unknown>, session: DispatchSession): Promise<KernelKindsResult> {
    const instance = this.registry.forClient(requireString(params, 'instanceId'), session.connectionId);

    return { kinds: toJson(await this.inHostSession(instance.kernel, session, (syntax) => syntax.kinds())) };
  }

  private async routeText(
    params: Record<string, unknown>,
    session: DispatchSession,
    signal: AbortSignal | undefined,
  ): Promise<KernelRouteResult> {
    const instance = this.registry.forClient(requireString(params, 'instanceId'), session.connectionId);
    const text = requireString(params, 'text');
    const stopOnFailure = optionalBoolean(params, 'stopOnFailure');
    const dryRun = optionalBoolean(params, 'dryRun');
    const maxOperations = params.maxOperations;

    if (maxOperations !== undefined && (typeof maxOperations !== 'number' || !Number.isInteger(maxOperations) || maxOperations < 1)) {
      throw new MethodError(Protocol.INVALID_PARAMS, 'maxOperations must be a positive integer', { field: 'maxOperations' });
    }

    const result = await this.inHostSession(instance.kernel, session, (syntax) => syntax.route(text, {
      ...(signal === undefined ? {} : { signal }),
      ...(stopOnFailure === undefined ? {} : { stopOnFailure }),
      ...(dryRun === undefined ? {} : { dryRun }),
      ...(maxOperations === undefined ? {} : { maxOperations }),
    }));

    return toJson(result);
  }
}

function success<TResult>(id: JsonRpcId, result: TResult): RpcSuccessResponse<TResult> {
  return { jsonrpc: '2.0', id, result };
}
