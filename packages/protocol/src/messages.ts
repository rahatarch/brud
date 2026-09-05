export type WebviewCommand =
  | 'applyPatch'
  | 'previewPatch'
  | 'previewNextFile'
  | 'previewPrevFile'
  | 'previewAllFiles'
  | 'executeCurrentFile'
  | 'executeAllFiles'
  | 'rejectPreview'
  | 'doneDiffPreview'
  | 'closeDiffPreview'
  | 'hidePreviewNavigation'
  | 'showPreviewNavigation'
  | 'updatePreviewHeader'
  | 'openMainWindow'
  | 'extractStructure'
  | 'ready'
  | 'getHistory'
  | 'getRevertHistory'
  | 'revertSession'
  | 'revertOperations'
  | 'deleteSingleSession'
  | 'wipeHistory'
  | 'softDeleteSession'
  | 'restoreSession'
  | 'getTrashedSessions'
  | 'permanentDelete'
  | 'getSessionSnapshots';

export type ExtensionCommand =
  | 'success'
  | 'error'
  | 'updatePreviewHeader'
  | 'showPreviewNavigation'
  | 'hidePreviewNavigation'
  | 'structureResult'
  | 'codebaseMetadataResult'
  | 'historyResult'
  | 'revertResult'
  | 'revertOperationsResult'
  | 'revertHistoryResult'
  | 'sessionDeleted'
  | 'historyWiped'
  | 'trashedSessionsResult'
  | 'sessionRestored'
  | 'searchFilesResult'
  | 'readResult'
  | 'diffPreviewResult'
  | 'filePatched'
  | 'sessionSnapshotsResult';

export interface WebviewMessage {
  command: WebviewCommand;
  text?: string;
  sessionId?: string;
  targetState?: 'pre' | 'post';
  operationIds?: string[];
  triggeredBy?: 'user' | 'system';
  permanentDelete?: boolean;
  fileIndex?: number;
}

export interface ExtensionMessage {
  command: ExtensionCommand;
  message?: string;
  fileName?: string;
  fileIndex?: number;
  totalFiles?: number;
  structure?: StructureResult;
  structures?: StructureResult[];
  codebaseMetadata?: CodebaseMetadataResult;
  history?: HistorySessionResult[];
  revertResult?: RevertSessionResult;
  revertOperationsResult?: RevertSessionResult;
  revertHistory?: RevertHistoryData[];
  deletedCount?: number;
  trashedSessions?: HistorySessionResult[];
  searchResults?: SearchFilesResult;
  readResult?: ReadResultData;
  diffPreviewData?: DiffPreviewData;
  snapshotData?: SessionSnapshotsResult | null;
}

export interface HistorySessionResult {
  sessionId: string;
  timestamp: string;
  originalPrompt: string;
  status: 'success' | 'failure';
  operationCount: number;
  operationTypes: string[];
  operations: OperationResult[];
  filesAffected: string[];
  metadataUsed: Record<string, any>;
  terminalCommands: string[];
  revertCommands: string[];
  isDeleted?: boolean;
  deletedAt?: string;
  expiresAt?: string;
  deletedBy?: 'user' | 'system';
  deleteReason?: 'manual_delete' | 'manual_wipe' | 'retention_cleanup';
  renewedAt?: string;
  softDeleteHistory?: SoftDeleteEventResult[];
}

export interface SoftDeleteEventResult {
  action: 'soft_delete' | 'restore';
  at: string;
  by: 'user' | 'system';
  reason?: 'manual_delete' | 'manual_wipe' | 'retention_cleanup';
}

export interface PreviewHeaderData {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
}

export interface OperationResult {
  operationId: string;
  operationIndex: number;
  kind: string;
  status: 'success' | 'aborted' | 'failed';
  message: string;
  path: string;
}

export interface ExecutionResult {
  success: boolean;
  message: string;
  errors: string[];
  operationResults: OperationResult[];
}

export interface StructureResult {
  json: string;
  directoryPath: string;
  depth: number;
  fileCount: number;
  directoryCount: number;
}

export interface CodebaseMetadataResult {
  root: string;
  totalFiles: number;
  totalFolders: number;
  mostDenseFolder: string;
  mostDenseCount: number;
}

export interface SearchFilesResult {
  results: Array<{ path: string; name: string; extension: string; directory: string; size: number }>;
  totalMatches: number;
  truncated: boolean;
}

export interface DiffFileEntry {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  languageId?: string;
}

export interface DiffPreviewData {
  files: DiffFileEntry[];
  currentIndex: number;
}

export interface ReadFileEntry {
  path: string;
  content: string;
  size: number;
  isImported?: boolean;
  importedFrom?: string;
}

export interface ReadResultData {
  files: ReadFileEntry[];
  totalFiles: number;
  totalSize: number;
}

export interface RevertSessionResult {
  success: boolean;
  message: string;
  errors: string[];
}

export interface RevertHistoryData {
  revertId: string;
  timestamp: string;
  targetState: 'pre' | 'post';
  revertedOperationIds: string[];
  status: 'success' | 'failed';
  errorMessage?: string;
}

export interface SnapshotDataResult {
  sessionId: string;
  snapshotType: 'pre' | 'post';
  files: Record<string, string>;
  diffFromPrevious: string;
}

export interface SessionSnapshotsResult {
  pre: SnapshotDataResult;
  post: SnapshotDataResult;
}