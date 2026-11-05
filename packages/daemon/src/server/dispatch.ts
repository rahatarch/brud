import { Buffer } from 'node:buffer';
import type {
  BrudKernel,
  IBrudFileSystem,
  IBrudToolsService,
  IPluginExecutionContext,
  IUniversalHistoryService,
  OperationResult,
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
  HistoryCommitOutcome,
  HistoryCommitSessionResult,
  HistoryGetResult,
  HistoryListParams,
  HistoryListResult,
  HistoryReversalTargetState,
  HistoryRevertResult,
  HistorySessionManifest,
  HistorySessionStatus,
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
  markHandshaken(): void;
}

export interface RequestDispatcherOptions {
  /**
   * Multi-workspace registry. When omitted, a private registry adopts
   * {@link kernel} for {@link workspaceRoot}.
   */
  readonly registry?: WorkspaceRegistry;
  /** Legacy single-kernel composition. */
  readonly kernel?: BrudKernel;
  readonly fileSystemToken: ServiceToken<IBrudFileSystem>;
  readonly historyToken: ServiceToken<IUniversalHistoryService>;
  readonly toolsToken?: ServiceToken<IBrudToolsService>;
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

function optionalStringArray(
  params: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be an array of strings`);
  }

  const items: readonly unknown[] = value;
  const strings: string[] = [];

  for (const item of items) {
    if (typeof item !== 'string') {
      throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be an array of strings`);
    }

    strings.push(item);
  }

  return strings;
}

function optionalBoolean(
  params: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be a boolean`);
  }

  return value;
}

function optionalInteger(
  params: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" must be an integer`);
  }

  return value;
}

function optionalHistoryOutcome(
  params: Record<string, unknown>,
  key: string,
): HistoryCommitOutcome | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (value === 'completed' || value === 'aborted') {
    return value;
  }

  throw new MethodError(
    Protocol.INVALID_PARAMS,
    `Parameter "${key}" must be "completed" or "aborted"`,
  );
}

function optionalReversalTargetState(
  params: Record<string, unknown>,
  key: string,
): HistoryReversalTargetState | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  if (value === 'pre' || value === 'post') {
    return value;
  }

  throw new MethodError(
    Protocol.INVALID_PARAMS,
    `Parameter "${key}" must be "pre" or "post"`,
  );
}

const HISTORY_STATUSES: readonly HistorySessionStatus[] = [
  'active',
  'committed',
  'aborted',
  'reverted',
];

function optionalHistoryStatus(
  params: Record<string, unknown>,
  key: string,
): HistorySessionStatus | undefined {
  const value = params[key];

  if (value === undefined) {
    return undefined;
  }

  for (const status of HISTORY_STATUSES) {
    if (value === status) {
      return status;
    }
  }

  throw new MethodError(Protocol.INVALID_PARAMS, `Parameter "${key}" is not a session status`);
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
  private readonly registry: WorkspaceRegistry;

  private readonly fileSystemToken: ServiceToken<IBrudFileSystem>;

  private readonly historyToken: ServiceToken<IUniversalHistoryService>;

  private readonly toolsToken: ServiceToken<IBrudToolsService> | undefined;

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

    this.fileSystemToken = options.fileSystemToken;
    this.historyToken = options.historyToken;
    this.toolsToken = options.toolsToken;
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
      case Protocol.HISTORY_BEGIN_SESSION:
        return success(request.id, await this.beginHistorySession(request.params, session));
      case Protocol.HISTORY_COMMIT_SESSION:
        return success(request.id, await this.commitHistorySession(request.params, session));
      case Protocol.HISTORY_REVERT:
        return success(request.id, await this.revertHistory(request.params, session));
      case Protocol.HISTORY_LIST:
        return success(request.id, await this.listHistory(request.params, session));
      case Protocol.HISTORY_GET:
        return success(request.id, await this.getHistory(request.params, session));
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
    session.markHandshaken();

    return {
      connectionId: session.connectionId,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      workspaceRoot,
      workspaceId: workspace.root,
      kernelState: 'running',
      capabilities: {
        protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
        workspaceRoot,
        fs: Protocol.FS_METHODS,
        history: Protocol.HISTORY_CAPABILITIES,
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

  private fileSystem(session: DispatchSession): IBrudFileSystem {
    const workspace = this.workspaceEntry(session);
    const caller: ServiceContext = {
      callerId: session.connectionId,
      tier: 'core',
      workspaceRoot: workspace.root,
    };

    return workspace.kernel.requestAccess(caller, this.fileSystemToken);
  }

  private history(session: DispatchSession): IUniversalHistoryService {
    const workspace = this.workspaceEntry(session);
    const caller: ServiceContext = {
      callerId: session.connectionId,
      tier: 'core',
      workspaceRoot: workspace.root,
    };

    return workspace.kernel.requestAccess(caller, this.historyToken);
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
    const caller: ServiceContext = {
      callerId: session.connectionId,
      tier: 'core',
      workspaceRoot: workspace.root,
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

  private async beginHistorySession(
    value: unknown,
    session: DispatchSession,
  ): Promise<{ readonly sessionId: string }> {
    const params = asParams(value);
    const prompt = requireString(params, 'prompt');
    const targets = optionalStringArray(params, 'targets');
    const sessionId = await this.history(session).beginSession(prompt, targets);

    return { sessionId };
  }

  private async commitHistorySession(
    value: unknown,
    session: DispatchSession,
  ): Promise<HistoryCommitSessionResult> {
    const params = asParams(value);
    const sessionId = requireString(params, 'sessionId');
    const outcome = optionalHistoryOutcome(params, 'outcome') ?? 'completed';

    return this.history(session).commitSession(sessionId, outcome);
  }

  private async revertHistory(
    value: unknown,
    session: DispatchSession,
  ): Promise<HistoryRevertResult> {
    const params = asParams(value);
    const sessionId = requireString(params, 'sessionId');
    const targetState = optionalReversalTargetState(params, 'targetState');
    const history = this.history(session);
    const plan = await history.planReversal(
      sessionId,
      targetState === undefined ? undefined : { targetState },
    );
    const actions = plan.actions.map((action) => ({
      relativePath: action.relativePath,
      action: action.action,
      expectedCurrentSha256: action.expectedCurrentSha256,
      actualCurrentSha256: action.actualCurrentSha256,
    }));
    const conflicts = plan.conflicts.map((conflict) => ({
      relativePath: conflict.relativePath,
      code: conflict.code,
      message: conflict.message,
      expectedSha256: conflict.expectedSha256,
      actualSha256: conflict.actualSha256,
    }));

    if (!plan.isExecutable) {
      return {
        sessionId: plan.sessionId,
        targetState: plan.targetState,
        isExecutable: false,
        actions,
        conflicts,
        receipt: null,
      };
    }

    const receipt = await history.executeReversal(plan);

    return {
      sessionId: plan.sessionId,
      targetState: plan.targetState,
      isExecutable: true,
      actions,
      conflicts,
      receipt,
    };
  }

  private async listHistory(
    value: unknown,
    session: DispatchSession,
  ): Promise<HistoryListResult> {
    const params = asParams(value);
    const includeDeleted = optionalBoolean(params, 'includeDeleted');
    const limit = optionalInteger(params, 'limit');
    const offset = optionalInteger(params, 'offset');
    const status = optionalHistoryStatus(params, 'status');
    const since = optionalString(params, 'since');
    const filter: HistoryListParams = {
      ...(includeDeleted === undefined ? {} : { includeDeleted }),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
      ...(status === undefined ? {} : { status }),
      ...(since === undefined ? {} : { since }),
    };
    const sessions = await this.history(session).listSessions(filter);

    return { sessions };
  }

  private async getHistory(
    value: unknown,
    session: DispatchSession,
  ): Promise<HistoryGetResult> {
    const params = asParams(value);
    const sessionId = requireString(params, 'sessionId');
    const manifest = await this.history(session).getSession(sessionId);
    const historySession: HistorySessionManifest | null = manifest;

    return { session: historySession };
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
