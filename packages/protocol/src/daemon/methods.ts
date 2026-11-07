import type { DaemonProtocolVersion } from './version.js';

export const DAEMON_CONNECT = 'daemon.connect';
export const DAEMON_PING = 'daemon.ping';
export const DAEMON_INFO = 'daemon.info';

export const WORKSPACE_LIST = 'workspace.list';
export const WORKSPACE_STATUS = 'workspace.status';
export const WORKSPACE_DISPOSE = 'workspace.dispose';

export const TOOLS_LIST = 'tools.list';
export const TOOLS_EXECUTE = 'tools.execute';

export const ACTIONS_LIST = 'actions.list';
export const ACTIONS_EXECUTE = 'actions.execute';

export const DAEMON_METHODS = [DAEMON_CONNECT, DAEMON_PING, DAEMON_INFO] as const;
export type DaemonMethod = (typeof DAEMON_METHODS)[number];

export const WORKSPACE_METHODS = [
  WORKSPACE_LIST,
  WORKSPACE_STATUS,
  WORKSPACE_DISPOSE,
] as const;
export type WorkspaceMethod = (typeof WORKSPACE_METHODS)[number];

export const TOOLS_METHODS = [TOOLS_LIST, TOOLS_EXECUTE] as const;
export type ToolsMethod = (typeof TOOLS_METHODS)[number];

export const ACTIONS_METHODS = [ACTIONS_LIST, ACTIONS_EXECUTE] as const;
export type ActionsMethod = (typeof ACTIONS_METHODS)[number];

export interface DaemonClientIdentity {
  readonly name: string;
  readonly version: string;
}

/**
 * Caller capability tier presented during `daemon.connect`.
 *
 * `ui` identifies a human-facing client (for example the editor UI) and `ai`
 * identifies an autonomous caller (for example an MCP bridge). UI-only RPC
 * families are gated on this value.
 */
export type DaemonCallerTier = 'ui' | 'ai';

export interface DaemonConnectParams {
  readonly protocolVersion: string;
  readonly token: string;
  readonly workspaceRoot: string;
  /**
   * Caller tier. Required for every new client: omitting `tier` is rejected as
   * `INVALID_PARAMS` rather than defaulted, so a caller cannot accidentally
   * bypass a UI-only guard. Legacy internal fixtures must send it explicitly.
   */
  readonly tier: DaemonCallerTier;
  /** Client identity supplied by newer clients. */
  readonly clientInfo?: DaemonClientIdentity;
  /** Legacy client identity field retained for wire compatibility. */
  readonly client?: DaemonClientIdentity;
  readonly capabilities?: readonly string[];
}

export interface DaemonServerIdentity {
  readonly name: string;
  readonly version: string;
  readonly pid: number;
}

export interface DaemonCapabilities {
  readonly protocolVersion: DaemonProtocolVersion;
  readonly workspaceRoot: string;
}

export interface DaemonHandshakeResult {
  readonly connectionId: string;
  readonly protocolVersion: DaemonProtocolVersion;
  readonly workspaceRoot: string;
  /** Validated caller tier recorded on the daemon session. */
  readonly tier: DaemonCallerTier;
  /** Canonical workspace root the connection is attached to. */
  readonly workspaceId: string;
  /** Kernel lifecycle state for the attached workspace. */
  readonly kernelState: 'running';
  readonly capabilities: DaemonCapabilities;
  readonly server: DaemonServerIdentity;
}

/** Lifecycle state of a daemon-managed workspace kernel. */
export type WorkspaceKernelState =
  | 'uninitialized'
  | 'booting'
  | 'running'
  | 'shutting-down'
  | 'disposed';

/** Wire projection of one workspace managed by the daemon registry. */
export interface WorkspaceDescriptor {
  readonly root: string;
  readonly clientCount: number;
  readonly kernelState: WorkspaceKernelState;
  readonly lastUsedAt: string;
}

export interface WorkspaceListResult {
  readonly workspaces: readonly WorkspaceDescriptor[];
}

export interface WorkspaceStatusParams {
  /** Workspace to describe. Defaults to the caller's attached workspace. */
  readonly workspaceRoot?: string;
}

export interface WorkspaceStatusResult {
  readonly workspace: WorkspaceDescriptor | null;
}

export interface WorkspaceDisposeParams {
  readonly workspaceRoot: string;
}

export interface WorkspaceDisposeResult {
  readonly root: string;
  readonly disposed: boolean;
}

/**
 * Handler-free projection of a registered tool.
 *
 * Mirrors the kernel's `RegisteredToolInfo` on the wire without importing the
 * kernel package.
 */
export interface RegisteredToolInfo {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: Readonly<Record<string, unknown>>;
  readonly requiredPermissions?: readonly string[];
  readonly ownerPluginId: string;
  readonly isOfficial: boolean;
}

export interface ToolsListResult {
  readonly tools: readonly RegisteredToolInfo[];
}

export interface ToolsExecuteParams {
  readonly name: string;
  readonly input?: unknown;
}

/**
 * JSON-serializable tool result.
 *
 * Mirrors the kernel `OperationResult`; `error` is flattened to text because a
 * thrown `Error` cannot cross the wire.
 */
export interface ToolOperationResult<TData = unknown> {
  readonly status: 'success' | 'failed' | 'aborted' | 'skipped';
  readonly data?: TData;
  readonly message?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface ToolsExecuteResult {
  readonly result: ToolOperationResult;
}

/**
 * Handler-free projection of a registered UI-only action.
 *
 * Mirrors the kernel's `RegisteredActionInfo` on the wire without importing
 * the kernel package. Actions never appear in `tools.list` and carry no
 * execution handle.
 */
export interface RegisteredActionInfo {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: Readonly<Record<string, unknown>>;
  readonly ownerPluginId: string;
}

/**
 * `actions.list` returns the registered action projections directly.
 *
 * The result is an array, not an envelope, so the UI can render the palette
 * without unwrapping a second object.
 */
export type ActionsListResult = readonly RegisteredActionInfo[];

export interface ActionsExecuteParams {
  readonly name: string;
  readonly input?: unknown;
}

/**
 * `actions.execute` returns the kernel `OperationResult` directly.
 *
 * `error` is flattened to text because a thrown `Error` cannot cross the wire.
 */
export type ActionsExecuteResult = ToolOperationResult;

export interface DaemonPingParams {
  readonly nonce?: string;
}

export interface DaemonPingResult {
  readonly connectionId: string;
  readonly timestamp: number;
  readonly nonce?: string;
}

export type DaemonEmptyParams = Record<string, never>;

export interface DaemonInfoResult {
  readonly connectionId: string;
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: DaemonProtocolVersion;
  readonly workspaceRoot: string;
  readonly pid: number;
  readonly uptimeMs: number;
}

export interface DaemonMethodMap {
  readonly 'daemon.connect': { readonly params: DaemonConnectParams; readonly result: DaemonHandshakeResult };
  readonly 'daemon.ping': { readonly params: DaemonPingParams; readonly result: DaemonPingResult };
  readonly 'daemon.info': { readonly params: DaemonEmptyParams; readonly result: DaemonInfoResult };
  readonly 'workspace.list': {
    readonly params: DaemonEmptyParams;
    readonly result: WorkspaceListResult;
  };
  readonly 'workspace.status': {
    readonly params: WorkspaceStatusParams;
    readonly result: WorkspaceStatusResult;
  };
  readonly 'workspace.dispose': {
    readonly params: WorkspaceDisposeParams;
    readonly result: WorkspaceDisposeResult;
  };
  readonly 'tools.list': {
    readonly params: DaemonEmptyParams;
    readonly result: ToolsListResult;
  };
  readonly 'tools.execute': {
    readonly params: ToolsExecuteParams;
    readonly result: ToolsExecuteResult;
  };
  readonly 'actions.list': {
    readonly params: DaemonEmptyParams;
    readonly result: ActionsListResult;
  };
  readonly 'actions.execute': {
    readonly params: ActionsExecuteParams;
    readonly result: ActionsExecuteResult;
  };
}

export type DaemonRequestMethod = keyof DaemonMethodMap;

export type DaemonMethodParams<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['params'];

export type DaemonMethodResult<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['result'];
