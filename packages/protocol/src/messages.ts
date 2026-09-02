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
  | 'openMainWindow';

export type ExtensionCommand =
  | 'success'
  | 'error'
  | 'updatePreviewHeader'
  | 'showPreviewNavigation'
  | 'hidePreviewNavigation';

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