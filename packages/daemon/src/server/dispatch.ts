import { Buffer } from 'node:buffer';
import type {
  BrudKernel,
  IBrudFileSystem,
  ServiceContext,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import * as Protocol from '@brud/protocol';
import type {
  DaemonHandshakeResult,
  DaemonInfoResult,
  DaemonPingResult,
  FileEncoding,
  FsExistsResult,
  FsListEntry,
  FsListResult,
  FsReadFileResult,
  FsStatResult,
  FsWriteAtomicResult,
  JsonRpcId,
  RpcErrorDetails,
  RpcRequest,
  RpcResponse,
  RpcSuccessResponse,
} from '@brud/protocol';
import { HandshakeValidator } from './handshake.js';
import { createRpcErrorResponse, toRpcErrorResponse } from './wireErrors.js';
import * as DaemonVersion from '../version.js';

export interface DispatchSession {
  readonly connectionId: string;
  readonly handshaken: boolean;
  markHandshaken(): void;
}

export interface RequestDispatcherOptions {
  readonly kernel: BrudKernel;
  readonly fileSystemToken: ServiceToken<IBrudFileSystem>;
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

function readEncoding(params: Record<string, unknown>, key: string): FileEncoding {
  const value = params[key];

  if (value === undefined) {
    return 'utf8';
  }

  if (value === 'utf8' || value === 'base64') {
    return value;
  }

  throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be "utf8" or "base64"`);
}

export class RequestDispatcher {
  private readonly kernel: BrudKernel;

  private readonly fileSystemToken: ServiceToken<IBrudFileSystem>;

  private readonly handshake: HandshakeValidator;

  private readonly serverName: string;

  private readonly serverVersion: string;

  private readonly startedAt: number = Date.now();

  constructor(options: RequestDispatcherOptions) {
    this.kernel = options.kernel;
    this.fileSystemToken = options.fileSystemToken;
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
      return success(request.id, this.connect(request.params, session));
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
      case Protocol.FS_READ_FILE:
        return success(request.id, await this.readFile(request.params, session));
      case Protocol.FS_WRITE_ATOMIC:
        return success(request.id, await this.writeAtomic(request.params, session));
      case Protocol.FS_EXISTS:
        return success(request.id, await this.exists(request.params, session));
      case Protocol.FS_LIST:
        return success(request.id, await this.list(request.params, session));
      case Protocol.FS_STAT:
        return success(request.id, await this.stat(request.params, session));
      default:
        if (Protocol.isHistoryMethod(request.method)) {
          throw new MethodError(
            Protocol.NOT_IMPLEMENTED,
            `Method "${request.method}" is not implemented`,
            { method: request.method },
          );
        }

        throw new MethodError(
          Protocol.METHOD_NOT_FOUND,
          `Unknown method "${request.method}"`,
          { method: request.method },
        );
    }
  }

  private connect(value: unknown, session: DispatchSession): DaemonHandshakeResult {
    const outcome = this.handshake.validate(value);

    if (!outcome.ok) {
      throw new MethodError(outcome.code, outcome.message, outcome.data);
    }

    session.markHandshaken();

    return {
      connectionId: session.connectionId,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      workspaceRoot: this.handshake.workspaceRoot,
      capabilities: {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        workspaceRoot: this.handshake.workspaceRoot,
        fs: Protocol.FS_METHODS,
        history: [],
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
      workspaceRoot: this.handshake.workspaceRoot,
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  private fileSystem(session: DispatchSession): IBrudFileSystem {
    const caller: ServiceContext = {
      callerId: session.connectionId,
      tier: 'core',
      workspaceRoot: this.handshake.workspaceRoot,
    };

    return this.kernel.requestAccess(caller, this.fileSystemToken);
  }

  private async readFile(value: unknown, session: DispatchSession): Promise<FsReadFileResult> {
    const params = asParams(value);
    const path = requireString(params, 'path');
    const encoding = readEncoding(params, 'encoding');
    const fileSystem = this.fileSystem(session);

    if (encoding === 'utf8') {
      const text = await fileSystem.readText(path, 'utf8');
      return { path, encoding, data: text };
    }

    const bytes = await fileSystem.readFile(path);
    return { path, encoding, data: Buffer.from(bytes).toString('base64') };
  }

  private async writeAtomic(value: unknown, session: DispatchSession): Promise<FsWriteAtomicResult> {
    const params = asParams(value);
    const path = requireString(params, 'path');
    const data = requireString(params, 'data');
    const encoding = readEncoding(params, 'encoding');
    const fileSystem = this.fileSystem(session);

    const bytes = encoding === 'utf8'
      ? Buffer.from(data, 'utf8')
      : Buffer.from(data, 'base64');

    await fileSystem.writeAtomic(path, bytes);
    return { path, bytesWritten: bytes.byteLength };
  }

  private async exists(value: unknown, session: DispatchSession): Promise<FsExistsResult> {
    const params = asParams(value);
    const path = requireString(params, 'path');
    const exists = await this.fileSystem(session).exists(path);

    return { path, exists };
  }

  private async list(value: unknown, session: DispatchSession): Promise<FsListResult> {
    const params = asParams(value);
    const path = optionalString(params, 'path') ?? '.';
    const entries = await this.fileSystem(session).readDirectory(path);
    const mapped: FsListEntry[] = entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile,
      isDirectory: entry.isDirectory,
    }));

    return { path, entries: mapped };
  }

  private async stat(value: unknown, session: DispatchSession): Promise<FsStatResult> {
    const params = asParams(value);
    const path = requireString(params, 'path');
    const stat = await this.fileSystem(session).stat(path);

    if (stat === null) {
      return { path, stat: null };
    }

    return {
      path,
      stat: {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
      },
    };
  }
}

function success<TResult>(id: JsonRpcId, result: TResult): RpcSuccessResponse<TResult> {
  return { jsonrpc: '2.0', id, result };
}
