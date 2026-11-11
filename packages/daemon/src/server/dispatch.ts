import type {
  BrudKernel,
  IActionManager,
  IBrudToolsService,
  IPluginExecutionContext,
  OperationResult,
  ServiceContext,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import * as Protocol from '@brud/protocol';
import type {
  ActionsListResult,
  ActionsExecuteResult,
  DaemonCallerTier,
  DaemonHandshakeResult,
  DaemonInfoResult,
  DaemonPingResult,
  JsonRpcId,
  RpcErrorDetails,
  RpcRequest,
  RpcResponse,
  RpcSuccessResponse,
} from '@brud/protocol';
import { HandshakeValidator } from './handshake.js';
import { createRpcErrorResponse, toRpcErrorResponse } from './wireErrors.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';
import type { KernelWorkspace } from '../workspaceRegistry.js';
import * as DaemonVersion from '../version.js';

export interface DispatchSession {
  readonly connectionId: string;
  readonly handshaken: boolean;
  /** Workspace the connection attached to during `daemon.connect`. */
  workspaceRoot: string | undefined;
  /** Caller tier asserted during `daemon.connect`; undefined before handshake. */
  tier: DaemonCallerTier | undefined;
  markHandshaken(): void;
}

/**
 * Rejects a session whose tier does not match the required tier.
 *
 * Throws a structured JSON-RPC error (`-32003` / `UNAUTHORIZED_TIER`) carrying
 * both the required and actual tiers. `tools.*` methods are intentionally not
 * guarded: both `ui` and `ai` callers may use them.
 */
export function requireTier(
  session: DispatchSession,
  required: DaemonCallerTier,
): void {
  const actual = session.tier;

  if (actual === required) {
    return;
  }

  throw new MethodError(
    -32003,
    'UNAUTHORIZED_TIER',
    {
      errorCode: 'UNAUTHORIZED_TIER',
      expected: required,
      actual: actual ?? 'unknown',
    },
  );
}

/**
 * Caller id the dispatcher presents when resolving the ActionManager token.
 *
 * The ActionManager's access-policy allowlist names this exact value, so the
 * UI RPC path can reach the service while arbitrary internal callers cannot.
 * It is deliberately not the connection id: the connection id identifies a
 * client, not a host authority.
 */
const ACTION_MANAGER_CALLER_ID = 'brud.host.daemon';

export interface RequestDispatcherOptions {
  /**
   * Multi-workspace registry. When omitted, a private registry adopts
   * {@link kernel} for {@link workspaceRoot}.
   */
  readonly registry?: WorkspaceRegistry;
  /** Single-kernel composition. */
  readonly kernel?: BrudKernel;
  readonly toolsToken?: ServiceToken<IBrudToolsService>;
  readonly actionsToken?: ServiceToken<IActionManager>;
  readonly token: string;
  readonly workspaceRoot: string;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

class MethodError extends Error {
  readonly rpcCode: Protocol.RpcErrorCode;

  readonly details: RpcErrorDetails | undefined;

  constructor(
    rpcCode: Protocol.RpcErrorCode,
    message: string,
    details?: RpcErrorDetails,
  ) {
    super(message);
    this.name = 'MethodError';
    this.rpcCode = rpcCode;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Re-validates the workspace options bag before building a caller context.
 *
 * Boot already validated the bag; this keeps the boundary explicit for hosts
 * that attach a context after the handshake.
 */
function assertContextOptions(workspace: KernelWorkspace): void {
  workspace.kernel.validateContextOptions?.(workspace.options);
}

function asParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new MethodError(Protocol.INVALID_PARAMS, 'Method params must be a JSON object');
  }

  return value;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];

  if (typeof value !== 'string') {
    throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be a string`);
  }

  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be a string`);
  }

  return value;
}

export class RequestDispatcher {
  private readonly registry: WorkspaceRegistry;

  private readonly toolsToken: ServiceToken<IBrudToolsService> | undefined;

  private readonly actionsToken: ServiceToken<IActionManager> | undefined;

  private readonly defaultWorkspaceRoot: string;

  private readonly enforcePrimaryWorkspaceRoot: boolean;

  private readonly handshake: HandshakeValidator;

  private readonly serverName: string;

  private readonly serverVersion: string;

  private readonly startedAt: number = Date.now();

  constructor(options: RequestDispatcherOptions) {
    if (options.registry !== undefined) {
      this.registry = options.registry;
    } else if (options.kernel !== undefined) {
      this.registry = new WorkspaceRegistry();
      this.registry.adopt(options.workspaceRoot, options.kernel);
    } else {
      throw new Error('RequestDispatcher requires a workspace registry or a kernel');
    }

    this.toolsToken = options.toolsToken;
    this.actionsToken = options.actionsToken;
    this.defaultWorkspaceRoot = options.workspaceRoot;
    this.enforcePrimaryWorkspaceRoot = options.registry === undefined;
    this.handshake = new HandshakeValidator({
      token: options.token,
      workspaceRoot: options.workspaceRoot,
    });
    this.serverName = options.serverName ?? DaemonVersion.DAEMON_SERVER_NAME;
    this.serverVersion = options.serverVersion ?? DaemonVersion.DAEMON_SERVER_VERSION;
  }

  async dispatch(request: RpcRequest, session: DispatchSession): Promise<RpcResponse> {
    try {
      return await this.route(request, session);
    } catch (error: unknown) {
      if (error instanceof MethodError) {
        return createRpcErrorResponse(request.id, error.rpcCode, error.message, error.details);
      }

      return toRpcErrorResponse(request.id, error);
    }
  }

  private async route(
    request: RpcRequest,
    session: DispatchSession,
  ): Promise<RpcResponse> {
    if (request.method === Protocol.DAEMON_CONNECT) {
      return success(request.id, await this.connect(request.params, session));
    }

    if (!session.handshaken) {
      throw new MethodError(
        Protocol.HANDSHAKE_REQUIRED,
        `Method "${request.method}" requires a completed daemon handshake`,
        { method: request.method },
      );
    }

    switch (request.method) {
      case Protocol.DAEMON_PING:
        return success(request.id, this.ping(request.params, session));
      case Protocol.DAEMON_INFO:
        return success(request.id, this.info(session));
      case Protocol.WORKSPACE_LIST:
        return success(request.id, this.listWorkspaces());
      case Protocol.WORKSPACE_STATUS:
        return success(request.id, this.workspaceStatus(request.params, session));
      case Protocol.WORKSPACE_DISPOSE:
        return success(request.id, await this.disposeWorkspace(request.params, session));
      case Protocol.TOOLS_LIST:
        return success(request.id, this.listTools(session));
      case Protocol.TOOLS_EXECUTE:
        return success(request.id, await this.executeTool(request.params, session));
      case Protocol.ACTIONS_LIST:
        requireTier(session, 'ui');
        return success(request.id, this.listActions(session));
      case Protocol.ACTIONS_EXECUTE:
        requireTier(session, 'ui');
        return success(request.id, await this.executeAction(request.params, session));
      default:
        throw new MethodError(
          Protocol.METHOD_NOT_FOUND,
          `Unknown method "${request.method}"`,
          { method: request.method },
        );
    }
  }

  private async connect(
    value: unknown,
    session: DispatchSession,
  ): Promise<DaemonHandshakeResult> {
    const outcome = this.enforcePrimaryWorkspaceRoot
      ? this.handshake.validate(value)
      : this.handshake.validateForRegistry(value);

    if (!outcome.ok) {
      throw new MethodError(outcome.code, outcome.message, outcome.data);
    }

    const workspaceRoot = outcome.params.workspaceRoot;

    if (session.workspaceRoot !== undefined && session.workspaceRoot !== workspaceRoot) {
      this.registry.detachClient(session.connectionId);
    }

    let workspace = this.registry.get(workspaceRoot);

    if (workspace === undefined) {
      workspace = await this.registry.spawn(workspaceRoot);
    }

    this.registry.attachClient(workspaceRoot, session.connectionId);
    session.workspaceRoot = workspaceRoot;
    session.tier = outcome.tier;
    session.markHandshaken();

    return {
      connectionId: session.connectionId,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      workspaceRoot,
      tier: outcome.tier,
      workspaceId: workspace.root,
      kernelState: 'running',
      capabilities: {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        workspaceRoot,
      },
      server: {
        name: this.serverName,
        version: this.serverVersion,
        pid: process.pid,
      },
    };
  }

  private ping(value: unknown, session: DispatchSession): DaemonPingResult {
    const params = asParams(value);
    const nonce = optionalString(params, 'nonce');
    const result: DaemonPingResult = {
      connectionId: session.connectionId,
      timestamp: Date.now(),
      ...(nonce === undefined ? {} : { nonce }),
    };

    return result;
  }

  private info(session: DispatchSession): DaemonInfoResult {
    return {
      connectionId: session.connectionId,
      name: this.serverName,
      version: this.serverVersion,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      workspaceRoot: this.sessionWorkspaceRoot(session),
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  private sessionWorkspaceRoot(session: DispatchSession): string {
    return session.workspaceRoot ?? this.defaultWorkspaceRoot;
  }

  private workspaceEntry(session: DispatchSession): KernelWorkspace {
    const root = session.workspaceRoot;

    if (root === undefined) {
      throw new MethodError(
        Protocol.HANDSHAKE_REQUIRED,
        'The connection is not attached to a workspace',
      );
    }

    const workspace = this.registry.get(root);

    if (workspace === undefined) {
      throw new MethodError(
        Protocol.INTERNAL_ERROR,
        `Workspace "${root}" is not registered`,
        { errorCode: 'WORKSPACE_NOT_FOUND', path: root },
      );
    }

    return workspace;
  }

  private brudTools(session: DispatchSession): IBrudToolsService {
    const token = this.toolsToken;

    if (token === undefined) {
      throw new MethodError(
        Protocol.INTERNAL_ERROR,
        'The tools service token is not configured',
        { errorCode: 'TOOLS_UNAVAILABLE' },
      );
    }

    const workspace = this.workspaceEntry(session);
    assertContextOptions(workspace);
    const caller: ServiceContext = {
      callerId: session.connectionId,
      tier: 'core',
      options: workspace.options,
    };

    return workspace.kernel.requestAccess(caller, token);
  }

  /**
   * Resolves the UI-only ActionManager for the caller workspace.
   *
   * The caller id is the fixed host authority, not the connection id, so the
   * ActionManager's allowlist admits exactly this path and rejects arbitrary
   * internal callers.
   */
  private actions(session: DispatchSession): IActionManager {
    const token = this.actionsToken;

    if (token === undefined) {
      throw new MethodError(
        Protocol.INTERNAL_ERROR,
        'The actions service token is not configured',
        { errorCode: 'ACTIONS_UNAVAILABLE' },
      );
    }

    const workspace = this.workspaceEntry(session);
    assertContextOptions(workspace);
    const caller: ServiceContext = {
      callerId: ACTION_MANAGER_CALLER_ID,
      tier: 'core',
      options: workspace.options,
    };

    return workspace.kernel.requestAccess(caller, token);
  }

  private listWorkspaces(): Protocol.WorkspaceListResult {
    return {
      workspaces: this.registry.list().map(describeWorkspace),
    };
  }

  private workspaceStatus(
    value: unknown,
    session: DispatchSession,
  ): Protocol.WorkspaceStatusResult {
    const params = asParams(value);
    const root = optionalString(params, 'workspaceRoot') ?? session.workspaceRoot;

    if (root === undefined) {
      throw new MethodError(
        Protocol.INVALID_PARAMS,
        'workspaceRoot is required when the connection is not attached to a workspace',
      );
    }

    const workspace = this.registry.get(root);

    return { workspace: workspace === undefined ? null : describeWorkspace(workspace) };
  }

  private async disposeWorkspace(
    value: unknown,
    session: DispatchSession,
  ): Promise<Protocol.WorkspaceDisposeResult> {
    const params = asParams(value);
    const root = requireString(params, 'workspaceRoot');
    const existed = this.registry.get(root) !== undefined;

    await this.registry.dispose(root);

    if (session.workspaceRoot === root) {
      session.workspaceRoot = undefined;
    }

    return { root, disposed: existed };
  }

  private listTools(session: DispatchSession): Protocol.ToolsListResult {
    const tools = this.brudTools(session).listTools();

    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersSchema: tool.parametersSchema,
        ...(tool.requiredPermissions === undefined
          ? {}
          : { requiredPermissions: tool.requiredPermissions }),
        ownerPluginId: tool.ownerPluginId,
        isOfficial: tool.isOfficial,
      })),
    };
  }

  private async executeTool(
    value: unknown,
    session: DispatchSession,
  ): Promise<Protocol.ToolsExecuteResult> {
    const params = asParams(value);
    const name = requireString(params, 'name');
    const workspace = this.workspaceEntry(session);
    const callerContext: IPluginExecutionContext = {
      workspaceRoot: workspace.root,
      callerId: session.connectionId,
      permissions: [],
      origin: 'daemon-rpc',
    };
    const result = await this.brudTools(session).executeTool(
      name,
      params.input,
      callerContext,
    );

    return { result: toProtocolOperationResult(result) };
  }

  private listActions(session: DispatchSession): ActionsListResult {
    return this.actions(session).listActions().map((action) => ({
      name: action.name,
      description: action.description,
      parametersSchema: action.parametersSchema,
      ownerPluginId: action.ownerPluginId,
    }));
  }

  private async executeAction(
    value: unknown,
    session: DispatchSession,
  ): Promise<ActionsExecuteResult> {
    const params = asParams(value);
    const name = requireString(params, 'name');
    const input = params.input;
    const workspace = this.workspaceEntry(session);
    const result = await this.actions(session).executeAction(name, input, {
      workspaceRoot: workspace.root,
      callerId: session.connectionId,
      origin: 'daemon-rpc',
    });

    return toProtocolOperationResult(result);
  }
}

const WORKSPACE_KERNEL_STATES: Readonly<
  Record<KernelWorkspace['kernel']['lifecycleState'], Protocol.WorkspaceKernelState>
> = {
  UNINITIALIZED: 'uninitialized',
  BOOTING: 'booting',
  RUNNING: 'running',
  SHUTTING_DOWN: 'shutting-down',
  DISPOSED: 'disposed',
};

function describeWorkspace(workspace: KernelWorkspace): Protocol.WorkspaceDescriptor {
  return {
    root: workspace.root,
    clientCount: workspace.clients.size,
    kernelState: WORKSPACE_KERNEL_STATES[workspace.kernel.lifecycleState],
    lastUsedAt: workspace.lastUsedAt.toISOString(),
  };
}

function toProtocolOperationResult(
  result: OperationResult,
): Protocol.ToolOperationResult {
  const error = result.error instanceof Error
    ? result.error.message
    : result.error;

  return {
    status: result.status,
    ...(result.data === undefined ? {} : { data: result.data }),
    ...(result.message === undefined ? {} : { message: result.message }),
    ...(error === undefined ? {} : { error }),
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
  };
}

function success<TResult>(id: JsonRpcId, result: TResult): RpcSuccessResponse<TResult> {
  return { jsonrpc: '2.0', id, result };
}
