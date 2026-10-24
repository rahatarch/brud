import * as vscode from 'vscode';
import { ExecuteCurrentFileHandler } from './ExecuteCurrentFileHandler';
import { ExecuteAllFilesHandler } from './ExecuteAllFilesHandler';
import { RejectPreviewHandler } from './RejectPreviewHandler';
import { DonePreviewHandler } from './DonePreviewHandler';
import { PreviewPrevFileHandler } from './PreviewPrevFileHandler';
import { PreviewNextFileHandler } from './PreviewNextFileHandler';
import { PanelManager } from '../services/PanelManager';
import { isWebviewMessage } from '@brud/protocol';

export class DiffPreviewRouter {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private panelManager: PanelManager,
    private executeCurrentFileHandler: ExecuteCurrentFileHandler,
    private executeAllFilesHandler: ExecuteAllFilesHandler,
    private rejectPreviewHandler: RejectPreviewHandler,
    private donePreviewHandler: DonePreviewHandler,
    private previewPrevFileHandler: PreviewPrevFileHandler,
    private previewNextFileHandler: PreviewNextFileHandler,
  ) {}

  async handle(message: unknown): Promise<void> {
    this.outputChannel.appendLine(`[DEBUG] DiffPreviewRouter received: ${JSON.stringify(message)}`);
    if (!isWebviewMessage(message)) {
      return;
    }
    switch (message.command) {
      case 'executeCurrentFile':
        await this.executeCurrentFileHandler.handle(message.fileIndex);
        break;
      case 'executeAllFiles':
        await this.executeAllFilesHandler.handle();
        break;
      case 'rejectPreview':
        await this.rejectPreviewHandler.handle();
        break;
      case 'doneDiffPreview':
        await this.donePreviewHandler.handle();
        break;
      case 'closeDiffPreview':
        this.panelManager.closeDiffPreview();
        break;
      case 'previewPrevFile':
        await this.previewPrevFileHandler.handle();
        break;
      case 'previewNextFile':
        await this.previewNextFileHandler.handle();
        break;
    }
  }
}