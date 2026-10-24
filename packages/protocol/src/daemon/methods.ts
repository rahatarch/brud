import type { DaemonProtocolVersion } from './version.js';

export const DAEMON_CONNECT = 'daemon.connect';
export const DAEMON_PING = 'daemon.ping';
export const DAEMON_INFO = 'daemon.info';

export const FS_READ_FILE = 'fs.readFile';
export const FS_WRITE_ATOMIC = 'fs.writeAtomic';
export const FS_EXISTS = 'fs.exists';
export const FS_LIST = 'fs.list';
export const FS_STAT = 'fs.stat';

export const HISTORY_BEGIN_SESSION = 'history.beginSession';
export const HISTORY_COMMIT_SESSION = 'history.commitSession';
export const HISTORY_REVERT = 'history.revert';
export const HISTORY_LIST = 'history.list';
export const HISTORY_GET = 'history.get';

export const DAEMON_METHODS = [DAEMON_CONNECT, DAEMON_PING, DAEMON_INFO] as const;
export type DaemonMethod = (typeof DAEMON_METHODS)[number];

export const FS_METHODS = [FS_READ_FILE, FS_WRITE_ATOMIC, FS_EXISTS, FS_LIST, FS_STAT] as const;
export type FsMethod = (typeof FS_METHODS)[number];

export const HISTORY_METHODS = [
  HISTORY_BEGIN_SESSION,
  HISTORY_COMMIT_SESSION,
  HISTORY_REVERT,
  HISTORY_LIST,
  HISTORY_GET,
] as const;
export type HistoryMethod = (typeof HISTORY_METHODS)[number];

/** Capability names advertised by a history-enabled daemon. */
export const HISTORY_CAPABILITIES = [
  'beginSession',
  'commitSession',
  'revert',
  'list',
  'get',
] as const;
export type HistoryCapability = (typeof HISTORY_CAPABILITIES)[number];

export const HISTORY_METHOD_PREFIX = 'history.';

export function isHistoryMethod(method: string): boolean {
  return method.startsWith(HISTORY_METHOD_PREFIX);
}

export type FileEncoding = 'utf8' | 'base64';

export interface DaemonClientIdentity {
  readonly name: string;
  readonly version: string;
}

export interface DaemonConnectParams {
  readonly protocolVersion: string;
  readonly token: string;
  readonly workspaceRoot: string;
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
  readonly fs: readonly FsMethod[];
  readonly history: readonly HistoryCapability[];
}

export interface DaemonHandshakeResult {
  readonly connectionId: string;
  readonly protocolVersion: DaemonProtocolVersion;
  readonly workspaceRoot: string;
  readonly capabilities: DaemonCapabilities;
  readonly server: DaemonServerIdentity;
}

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

export interface FsReadFileParams {
  readonly path: string;
  readonly encoding?: FileEncoding;
}

export interface FsReadFileResult {
  readonly path: string;
  readonly encoding: FileEncoding;
  readonly data: string;
}

export interface FsWriteAtomicParams {
  readonly path: string;
  readonly data: string;
  readonly encoding?: FileEncoding;
}

export interface FsWriteAtomicResult {
  readonly path: string;
  readonly bytesWritten: number;
}

export interface FsExistsParams {
  readonly path: string;
}

export interface FsExistsResult {
  readonly path: string;
  readonly exists: boolean;
}

export interface FsListParams {
  readonly path?: string;
}

export interface FsListEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export interface FsListResult {
  readonly path: string;
  readonly entries: readonly FsListEntry[];
}

export interface FsStatParams {
  readonly path: string;
}

export interface FsStatEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

export interface FsStatResult {
  readonly path: string;
  readonly stat: FsStatEntry | null;
}

export type HistorySessionStatus = 'active' | 'committed' | 'aborted' | 'reverted';

export type HistoryCommitOutcome = 'completed' | 'aborted';

export type HistoryReversalTargetState = 'pre' | 'post';

export type HistoryReversalActionKind = 'restore' | 'delete';

export type HistoryReversalConflictCode = 'STALE_BASELINE_CONFLICT' | 'BLOB_NOT_FOUND';

/** Durable session row returned by `history.list`. */
export interface HistorySessionRow {
  readonly session_id: string;
  readonly created_at: string;
  readonly prompt: string;
  readonly status: HistorySessionStatus;
  readonly files_affected: string;
  readonly is_deleted: number;
  readonly deleted_at: string | null;
  readonly expires_at: string | null;
}

/** Digest record embedded in a session manifest. */
export interface HistoryTargetDigest {
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly isBinary: boolean;
  readonly exists: boolean;
}

/** Session manifest returned by `history.get`. */
export interface HistorySessionManifest {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly prompt: string;
  readonly status: HistorySessionStatus;
  readonly filesAffected: readonly string[];
  readonly preDigests: Readonly<Record<string, HistoryTargetDigest>>;
  readonly postDigests: Readonly<Record<string, HistoryTargetDigest>>;
  readonly revertRecordIds?: readonly string[];
  readonly isDeleted?: boolean;
  readonly deletedAt?: string;
  readonly expiresAt?: string;
}

export interface HistoryBeginSessionParams {
  readonly prompt: string;
  readonly targets?: readonly string[];
}

export interface HistoryBeginSessionResult {
  readonly sessionId: string;
}

export interface HistoryCommitSessionParams {
  readonly sessionId: string;
  readonly outcome?: HistoryCommitOutcome;
}

export interface HistoryCasBlobWrite {
  readonly sha256: string;
  readonly relativePath: string;
}

export interface HistoryCommitSessionResult {
  readonly sessionId: string;
  readonly committedFileCount: number;
  readonly committedAt: string;
  readonly blobs: readonly HistoryCasBlobWrite[];
}

export interface HistoryRevertParams {
  readonly sessionId: string;
  readonly targetState?: HistoryReversalTargetState;
}

export interface HistoryReversalActionSummary {
  readonly relativePath: string;
  readonly action: HistoryReversalActionKind;
  readonly expectedCurrentSha256: string;
  readonly actualCurrentSha256: string | null;
}

export interface HistoryReversalConflict {
  readonly relativePath: string;
  readonly code: HistoryReversalConflictCode;
  readonly message: string;
  readonly expectedSha256: string;
  readonly actualSha256: string | null;
}

export interface HistoryReversalReceipt {
  readonly reversalId: string;
  readonly sessionId: string;
  readonly targetState: HistoryReversalTargetState;
  readonly executedAt: string;
  readonly filesRestored: number;
  readonly filesDeleted: number;
}

export interface HistoryRevertResult {
  readonly sessionId: string;
  readonly targetState: HistoryReversalTargetState;
  readonly isExecutable: boolean;
  readonly actions: readonly HistoryReversalActionSummary[];
  readonly conflicts: readonly HistoryReversalConflict[];
  readonly receipt: HistoryReversalReceipt | null;
}

export interface HistoryListParams {
  readonly includeDeleted?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  readonly status?: HistorySessionStatus;
  readonly since?: string;
}

export interface HistoryListResult {
  readonly sessions: readonly HistorySessionRow[];
}

export interface HistoryGetParams {
  readonly sessionId: string;
}

export interface HistoryGetResult {
  readonly session: HistorySessionManifest | null;
}

export interface DaemonMethodMap {
  readonly 'daemon.connect': { readonly params: DaemonConnectParams; readonly result: DaemonHandshakeResult };
  readonly 'daemon.ping': { readonly params: DaemonPingParams; readonly result: DaemonPingResult };
  readonly 'daemon.info': { readonly params: DaemonEmptyParams; readonly result: DaemonInfoResult };
  readonly 'fs.readFile': { readonly params: FsReadFileParams; readonly result: FsReadFileResult };
  readonly 'fs.writeAtomic': { readonly params: FsWriteAtomicParams; readonly result: FsWriteAtomicResult };
  readonly 'fs.exists': { readonly params: FsExistsParams; readonly result: FsExistsResult };
  readonly 'fs.list': { readonly params: FsListParams; readonly result: FsListResult };
  readonly 'fs.stat': { readonly params: FsStatParams; readonly result: FsStatResult };
  readonly 'history.beginSession': {
    readonly params: HistoryBeginSessionParams;
    readonly result: HistoryBeginSessionResult;
  };
  readonly 'history.commitSession': {
    readonly params: HistoryCommitSessionParams;
    readonly result: HistoryCommitSessionResult;
  };
  readonly 'history.revert': {
    readonly params: HistoryRevertParams;
    readonly result: HistoryRevertResult;
  };
  readonly 'history.list': {
    readonly params: HistoryListParams;
    readonly result: HistoryListResult;
  };
  readonly 'history.get': {
    readonly params: HistoryGetParams;
    readonly result: HistoryGetResult;
  };
}

export type DaemonRequestMethod = keyof DaemonMethodMap;

export type DaemonMethodParams<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['params'];

export type DaemonMethodResult<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['result'];
