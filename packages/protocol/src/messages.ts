export const WEBVIEW_COMMANDS = [
  'applyPatch',
  'previewPatch',
  'previewNextFile',
  'previewPrevFile',
  'previewAllFiles',
  'executeCurrentFile',
  'executeAllFiles',
  'rejectPreview',
  'doneDiffPreview',
  'closeDiffPreview',
  'hidePreviewNavigation',
  'showPreviewNavigation',
  'updatePreviewHeader',
  'openMainWindow',
  'extractStructure',
  'ready',
  'getHistory',
  'getRevertHistory',
  'revertSession',
  'revertOperations',
  'deleteSingleSession',
  'wipeHistory',
  'softDeleteSession',
  'restoreSession',
  'restoreAllSessions',
  'getTrashedSessions',
  'permanentDelete',
  'getSessionSnapshots',
  'openUnifiedResults',
  'openPromptLibrary',
  'openGetStarted',
  'previewNoChanges',
  'getSettings',
  'saveSettings',
  'getToolList',
  'getPrompts',
  'savePrompt',
  'deletePrompt',
  'getPromptVersions',
  'revertPrompt',
  'killProcess',
  'copyPrompt',
  'getMcpStatus',
  'startMcpServer',
  'stopMcpServer',
  'setMcpAutoOn',
  'copyMcpConfig',
  'getActiveProcessIds',
] as const;

export type WebviewCommand = typeof WEBVIEW_COMMANDS[number];

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
  | 'allSessionsRestored'
  | 'searchFilesResult'
  | 'readResult'
  | 'diffPreviewResult'
  | 'filePatched'
  | 'sessionSnapshotsResult'
  | 'previewNoChanges'
  | 'settingsResult'
  | 'settingsSaved'
  | 'toolListResult'
  | 'promptsResult'
  | 'promptSaved'
  | 'promptDeleted'
  | 'promptVersionsResult'
  | 'promptReverted'
  | 'terminalChunk'
  | 'executionState'
  | 'activeProcessIds'
  | 'unifiedResults'
  | 'noPreviewableOps'
  | 'executeSuccess'
  | 'mcpStatus'
  | 'mcpConfigCopied';

export type McpServerPhase = 'stopped' | 'starting' | 'running' | 'stopping';

export interface McpStatusPayload {
  phase: McpServerPhase;
  workspaceRoot?: string;
  url?: string;
  port?: number;
  error?: string;
  autoOn: boolean;
}

export interface PromptVersionPayload {
  version: number;
  content: string;
  timestamp: string;
  message?: string;
}

export interface PromptPayload {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  scope: 'global' | 'workspace';
  versions: PromptVersionPayload[];
}

export interface BrudSettingsPayload {
  workspaceBoundaryEnabled?: boolean;
  commandValidationEnabled?: boolean;
  toolAllowList?: Record<string, boolean>;
  mcpAutoOn?: boolean;
  readConcurrency?: number;
  readMaxBatchFiles?: number;
  readMaxAggregateBytes?: number;
}

export interface WebviewMessage {
  command: WebviewCommand;
  text?: string;
  sessionId?: string;
  targetState?: 'pre' | 'post';
  operationIds?: string[];
  triggeredBy?: 'user' | 'system';
  permanentDelete?: boolean;
  fileIndex?: number;
  settings?: BrudSettingsPayload;
  promptId?: string;
  promptData?: PromptPayload;
  promptScope?: 'global' | 'workspace';
  version?: number;
  processId?: string;
  enabled?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWebviewCommand(value: unknown): value is WebviewCommand {
  return typeof value === 'string' && (WEBVIEW_COMMANDS as readonly string[]).includes(value);
}

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  return isRecord(value) && isWebviewCommand(value.command);
}

export interface ReportSection {
  type: 'summary' | 'table' | 'details' | 'button' | 'copyButton' | 'text';
  title?: string;
  content?: string;
  items?: Array<{ label: string; value: string; status?: 'success' | 'failed' | 'aborted' | 'interrupted' }>;
  buttonText?: string;
  buttonAction?: WebviewCommand;
  copyText?: string;
}

export interface UnifiedOperationResult {
  toolKind: string;
  data: unknown;
}

export interface UnifiedSessionResults {
  operations: UnifiedOperationResult[];
}

export interface ExtensionMessage {
  command: ExtensionCommand;
  mcpStatus?: McpStatusPayload;
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
  restoredCount?: number;
  trashedSessions?: HistorySessionResult[];
  searchResults?: SearchFilesResult;
  readResult?: ReadResultData;
  diffPreviewData?: DiffPreviewData;
  snapshotData?: SessionSnapshotsResult | null;
  structured?: ReportSection[];
  settings?: BrudSettingsPayload;
  source?: string;
  warnings?: string[];
  tools?: Array<{ kind: string; name: string; description: string }>;
  prompts?: PromptPayload[];
  prompt?: PromptPayload;
  versions?: PromptVersionPayload[];
  savedPromptId?: string;
  errorMessage?: string;
  processId?: string;
  chunk?: string;
  chunkIndex?: number;
  streamDone?: boolean;
  streamStatus?: 'success' | 'failed' | 'interrupted';
  executing?: boolean;
  results?: UnifiedSessionResults;
  detail?: string;
  processIds?: string[];
}

export interface HistorySessionResult {
  sessionId: string;
  timestamp: string;
  originalPrompt: string;
  status: 'success' | 'failure' | 'interrupted';
  operationCount: number;
  operationTypes: string[];
  operations: OperationResult[];
  filesAffected: string[];
  metadataUsed: Record<string, unknown>;
  terminalCommands: string[];
  revertCommands: string[];
  sessionTitle?: string;
  sessionDescription?: string;
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
  status: 'success' | 'aborted' | 'failed' | 'interrupted';
  message: string;
  code?: string;
  details?: string;
  path: string;
  to?: string;
  title?: string;
  description?: string;
  fileResults?: {
    modified: string[];
    skipped: string[];
    failed: string[];
    fileErrors?: Array<{ path: string; code?: string; details?: string }>;
  };
  data?: { command: string; output: string; exitCode: number | null; duration: number; success: boolean } | Array<{ command: string; output: string; exitCode: number | null; duration: number; success: boolean }>;
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
  startLine?: number;
  endLine?: number;
  totalLines?: number;
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