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
export const HISTORY_END_SESSION = 'history.endSession';
export const HISTORY_GET_SESSION = 'history.getSession';
export const HISTORY_LIST = 'history.list';
export const HISTORY_RECORD_EVENT = 'history.recordEvent';

export const DAEMON_METHODS = [DAEMON_CONNECT, DAEMON_PING, DAEMON_INFO] as const;
export type DaemonMethod = (typeof DAEMON_METHODS)[number];

export const FS_METHODS = [FS_READ_FILE, FS_WRITE_ATOMIC, FS_EXISTS, FS_LIST, FS_STAT] as const;
export type FsMethod = (typeof FS_METHODS)[number];

export const HISTORY_METHODS = [
  HISTORY_BEGIN_SESSION,
  HISTORY_END_SESSION,
  HISTORY_GET_SESSION,
  HISTORY_LIST,
  HISTORY_RECORD_EVENT,
] as const;
export type HistoryMethod = (typeof HISTORY_METHODS)[number];

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
  readonly history: readonly HistoryMethod[];
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

export interface DaemonMethodMap {
  readonly 'daemon.connect': { readonly params: DaemonConnectParams; readonly result: DaemonHandshakeResult };
  readonly 'daemon.ping': { readonly params: DaemonPingParams; readonly result: DaemonPingResult };
  readonly 'daemon.info': { readonly params: DaemonEmptyParams; readonly result: DaemonInfoResult };
  readonly 'fs.readFile': { readonly params: FsReadFileParams; readonly result: FsReadFileResult };
  readonly 'fs.writeAtomic': { readonly params: FsWriteAtomicParams; readonly result: FsWriteAtomicResult };
  readonly 'fs.exists': { readonly params: FsExistsParams; readonly result: FsExistsResult };
  readonly 'fs.list': { readonly params: FsListParams; readonly result: FsListResult };
  readonly 'fs.stat': { readonly params: FsStatParams; readonly result: FsStatResult };
}

export type DaemonRequestMethod = keyof DaemonMethodMap;

export type DaemonMethodParams<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['params'];

export type DaemonMethodResult<TMethod extends DaemonRequestMethod> = DaemonMethodMap[TMethod]['result'];
