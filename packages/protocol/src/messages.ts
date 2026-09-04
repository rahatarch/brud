export type WebviewCommand =
  | 'applyPatch'
  | 'previewPatch'
  | 'previewNextFile'
  | 'previewPrevFile'
  | 'previewAllFiles'
  | 'executeCurrentFile'
  | 'executeAllFiles'
  | 'hidePreviewNavigation'
  | 'showPreviewNavigation'
  | 'updatePreviewHeader'
  | 'openMainWindow'
  | 'extractStructure'
  | 'ready'
  | 'getHistory'
  | 'getRevertHistory'
  | 'revertSession'
  | 'wipeHistory';

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
  | 'revertHistoryResult'
  | 'historyWiped';

export interface WebviewMessage {
  command: WebviewCommand;
  text?: string;
  sessionId?: string;
  targetState?: 'pre' | 'post';
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
  revertHistory?: RevertHistoryData[];
  deletedCount?: number;
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
}

export interface PreviewHeaderData {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
}

export interface OperationResult {
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

export interface RevertSessionResult {
  success: boolean;
  message: string;
  errors: string[];
}

export interface RevertHistoryData {
  revertId: string;
  timestamp: string;
  targetState: 'pre' | 'post';
  filesRestored: string[];
  status: 'success' | 'failed';
  errorMessage?: string;
}