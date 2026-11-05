import type {
  DaemonHandshakeResult,
  FileEncoding,
  FsListEntry,
  FsStatResult,
  FsWriteAtomicResult,
  HistoryCommitOutcome,
  HistoryCommitSessionResult,
  HistoryReversalTargetState,
  HistoryRevertResult,
} from '@brud/protocol';

export interface DaemonExecutionClient {
  readonly handshake?: DaemonHandshakeResult;
  fsReadFile(path: string, encoding?: FileEncoding): Promise<string>;
  fsWriteAtomic(
    path: string,
    data: Uint8Array | string,
    encoding?: FileEncoding,
  ): Promise<FsWriteAtomicResult>;
  fsExists(path: string): Promise<boolean>;
  fsList(path: string, limit?: number): Promise<readonly FsListEntry[]>;
  fsStat(path: string): Promise<FsStatResult['stat']>;
  historyBeginSession(prompt: string, targets?: readonly string[]): Promise<string>;
  historyCommitSession(
    sessionId: string,
    outcome?: HistoryCommitOutcome,
  ): Promise<HistoryCommitSessionResult>;
  historyRevert(
    sessionId: string,
    targetState?: HistoryReversalTargetState,
  ): Promise<HistoryRevertResult>;
}

export function resolveClientWorkspaceRoot(
  client: DaemonExecutionClient,
  fallbackWorkspaceRoot: string,
): string {
  return client.handshake?.workspaceRoot ?? fallbackWorkspaceRoot;
}
