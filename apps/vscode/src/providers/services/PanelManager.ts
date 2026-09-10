import { BrudDiffPreviewPanelManager } from '../DiffPreviewPanelProvider';
import type { DiffPreviewData } from '@brud/protocol';

export class PanelManager {
  constructor(
    public readonly unifiedResultsPanelManager: any,
    public readonly diffPreviewPanelManager: BrudDiffPreviewPanelManager,
    public readonly mainWindowProvider: any,
    public readonly structurePanelManager: any,
    public readonly readPanelManager: any,
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
}