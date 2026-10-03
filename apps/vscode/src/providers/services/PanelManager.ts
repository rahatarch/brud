import { BrudDiffPreviewPanelManager } from '../DiffPreviewPanelProvider';
import { BrudTerminalPanelManager } from '../TerminalStreamPanelProvider';
import type { DiffPreviewData } from '@brud/protocol';

export class PanelManager {
  constructor(
    public readonly unifiedResultsPanelManager: any,
    public readonly diffPreviewPanelManager: BrudDiffPreviewPanelManager,
    public readonly mainWindowProvider: any,
    public readonly structurePanelManager: any,
    public readonly readPanelManager: any,
    public readonly terminalPanelManager: BrudTerminalPanelManager,
  ) {}

  showUnifiedResults(results: Record<string, any>): void {
    this.unifiedResultsPanelManager?.openUnifiedResultsPanel(results);
  }

  showDiffPreview(data: DiffPreviewData): void {
    this.diffPreviewPanelManager.openDiffPreview(data);
  }

  showNoPreview(detail?: string): void {
    this.diffPreviewPanelManager.openNoPreviewPanel(detail);
  }

  postDiffPreviewMessage(message: any): void {
    this.diffPreviewPanelManager.postMessage(message);
  }

  closeDiffPreview(): void {
    this.diffPreviewPanelManager.closePanel();
  }

  showMainWindow(): void {
    this.mainWindowProvider?.openMainWindow();
  }

  showStructure(data: any): void {
    this.structurePanelManager?.openStructurePanel(data);
  }

  showRead(data: any): void {
    this.readPanelManager?.openReadPanel(data);
  }

  showTerminalStream(): void {
    this.terminalPanelManager.openTerminalStreamPanel();
  }

  closeTerminalStreamPanel(): void {
    this.terminalPanelManager.closePanel();
  }

  postTerminalChunk(chunk: string, chunkIndex: number, processId: string): void {
    this.terminalPanelManager.postChunk(chunk, chunkIndex, processId);
  }

  postStreamDone(processId: string, status: 'success' | 'failed' | 'interrupted'): void {
    this.terminalPanelManager.postStreamDone(processId, status);
  }
}