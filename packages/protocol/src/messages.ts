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
  | 'restoreAllSessions'
  | 'getTrashedSessions'
  | 'permanentDelete'
  | 'getSessionSnapshots'
  | 'openUnifiedResults'
  | 'openPromptLibrary'
  | 'openGetStarted'
  | 'openStreamTest'
  | 'previewNoChanges'
  | 'getSettings'
  | 'saveSettings'
  | 'getToolList'
  | 'getPrompts'
  | 'savePrompt'
  | 'deletePrompt'
  | 'getPromptVersions'
  | 'revertPrompt'
  | 'aiChat'
  | 'requestProviders'
  | 'selectModel'
  | 'saveProvider'
  | 'deleteProvider'
  | 'connectKey'
  | 'disconnectKey';

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
  | 'aiChunk'
  | 'aiDone'
  | 'aiError'
  | 'aiReasoningChunk'
  | 'aiReasoningDone'
  | 'providersLoaded'
  | 'modelSelected'
  | 'setActiveTab';

export interface WebviewMessage {
  command: WebviewCommand;
  text?: string;
  sessionId?: string;
  targetState?: 'pre' | 'post';
  operationIds?: string[];
  triggeredBy?: 'user' | 'system';
  permanentDelete?: boolean;
  fileIndex?: number;
  settings?: Record<string, any>;
  promptId?: string;
  promptData?: any;
  promptScope?: 'global' | 'workspace';
  version?: number;
}

export interface ReportSection {
  type: 'summary' | 'table' | 'details' | 'button' | 'copyButton' | 'text';
  title?: string;
  content?: string;
  items?: Array<{ label: string; value: string; status?: 'success' | 'failed' | 'aborted' }>;
  buttonText?: string;
  buttonAction?: string;
  copyText?: string;
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
  restoredCount?: number;
  trashedSessions?: HistorySessionResult[];
  searchResults?: SearchFilesResult;
  readResult?: ReadResultData;
  diffPreviewData?: DiffPreviewData;
  snapshotData?: SessionSnapshotsResult | null;
  structured?: ReportSection[];
  settings?: Record<string, any>;
  source?: string;
  warnings?: string[];
  tools?: Array<{ kind: string; name: string; description: string }>;
  prompts?: any[];
  prompt?: any;
  versions?: any[];
  savedPromptId?: string;
  errorMessage?: string;
  chunk?: string;
  fullText?: string;
  reasoningChunk?: string;
  fullReasoning?: string;
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
  status: 'success' | 'aborted' | 'failed';
  message: string;
  path: string;
  title?: string;
  description?: string;
  fileResults?: {
    modified: string[];
    skipped: string[];
    failed: string[];
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

export interface UnifiedOperation {
  kind: string;
  filePath: string;
  success: boolean;
  message: string;
  details?: unknown;
}

export interface PackageResultInput {
  operations: UnifiedOperation[];
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  status: 'success' | 'failure' | 'partial';
  summary: string;
}

export interface AiChatMessage extends WebviewMessage {
  command: 'aiChat';
  text: string;
}

export interface AiChunkMessage extends ExtensionMessage {
  command: 'aiChunk';
  chunk: string;
}

export interface AiDoneMessage extends ExtensionMessage {
  command: 'aiDone';
  fullText: string;
}

export interface AiErrorMessage extends ExtensionMessage {
  command: 'aiError';
  message: string;
}

// ── Vault / Provider message shapes ──────────────────────────────────

export interface VaultProviderModel {
  id: string;
  name: string;
  contextLength?: number;
  supportsReasoning?: boolean;
}

export interface VaultProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  models: VaultProviderModel[];
  isCustom?: boolean;
  requiresKey?: boolean;
}

export interface VaultSanitizedProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: VaultProviderModel[];
  isCustom?: boolean;
  requiresKey?: boolean;
  hasKey: boolean;
}

export interface VaultModelSelection {
  providerID: string;
  modelID: string;
}

// Webview -> Extension
export interface RequestProvidersMessage extends WebviewMessage {
  command: 'requestProviders';
}

export interface SelectModelMessage extends WebviewMessage {
  command: 'selectModel';
  selection: VaultModelSelection;
}

export interface SaveProviderMessage extends WebviewMessage {
  command: 'saveProvider';
  provider: VaultProviderConfig;
  apiKey?: string;
}

export interface DeleteProviderMessage extends WebviewMessage {
  command: 'deleteProvider';
  providerId: string;
}

export interface ConnectKeyMessage extends WebviewMessage {
  command: 'connectKey';
  providerId: string;
  apiKey: string;
}

export interface DisconnectKeyMessage extends WebviewMessage {
  command: 'disconnectKey';
  providerId: string;
}

// Extension -> Webview
export interface ProvidersLoadedMessage extends ExtensionMessage {
  command: 'providersLoaded';
  providers: VaultSanitizedProvider[];
  activeSelection: VaultModelSelection;
}

export interface ModelSelectedMessage extends ExtensionMessage {
  command: 'modelSelected';
  selection: VaultModelSelection;
}

export interface OpenMainWindowMessage extends WebviewMessage {
  command: 'openMainWindow';
  tab?: string;
  subView?: string;
}

export interface SetActiveTabMessage extends ExtensionMessage {
  command: 'setActiveTab';
  tab: string;
  subView?: string;
}