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
  | 'getHistory';

export type ExtensionCommand =
  | 'success'
  | 'error'
  | 'updatePreviewHeader'
  | 'showPreviewNavigation'
  | 'hidePreviewNavigation'
  | 'structureResult'
  | 'codebaseMetadataResult'
  | 'historyResult';

export interface WebviewMessage {
  command: WebviewCommand;
  text?: string;
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
}

export interface HistorySessionResult {
  sessionId: string;
  timestamp: string;
  originalPrompt: string;
  status: 'success' | 'failure';
  operationCount: number;
  operationTypes: string[];
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

export interface ExecutionResult {
  success: boolean;
  message: string;
  errors: string[];
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