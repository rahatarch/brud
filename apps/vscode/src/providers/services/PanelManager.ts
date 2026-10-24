import type { BrudUnifiedResultsPanelManager } from '../UnifiedResultsPanelProvider';
import { BrudDiffPreviewPanelManager } from '../DiffPreviewPanelProvider';
import { BrudTerminalPanelManager } from '../TerminalStreamPanelProvider';
import type { BrudMainWindowManager } from '../MainWindowProvider';
import type { BrudStructurePanelManager, StructurePanelPayload } from '../StructurePanelProvider';
import type { BrudReadPanelManager } from '../ReadPanelProvider';
import type {
  DiffPreviewData,
  ExtensionMessage,
  ReadResultData,
  UnifiedSessionResults,
} from '@brud/protocol';

export class PanelManager {
  constructor(
    public readonly unifiedResultsPanelManager: BrudUnifiedResultsPanelManager | undefined,
    public readonly diffPreviewPanelManager: BrudDiffPreviewPanelManager,
    public readonly mainWindowProvider: BrudMainWindowManager | undefined,
    public readonly structurePanelManager: BrudStructurePanelManager | undefined,
    public readonly readPanelManager: BrudReadPanelManager | undefined,
    public readonly terminalPanelManager: BrudTerminalPanelManager,
  ) {}

  showUnifiedResults(results: UnifiedSessionResults): void {
    this.unifiedResultsPanelManager?.openUnifiedResultsPanel(results);
  }

  showDiffPreview(data: DiffPreviewData): void {
    this.diffPreviewPanelManager.openDiffPreview(data);
  }

  showNoPreview(detail?: string): void {
    this.diffPreviewPanelManager.openNoPreviewPanel(detail);
  }

  postDiffPreviewMessage(message: ExtensionMessage): void {
    this.diffPreviewPanelManager.postMessage(message);
  }

  postDiffPreviewMessageIfOpen(message: ExtensionMessage): void {
    this.diffPreviewPanelManager.postIfOpen(message);
  }

  closeDiffPreview(): void {
    this.diffPreviewPanelManager.closePanel();
  }

  showMainWindow(): void {
    this.mainWindowProvider?.openMainWindow();
  }

  showStructure(data: StructurePanelPayload): void {
    this.structurePanelManager?.openStructurePanel(data);
  }

  showRead(data: ReadResultData): void {
    this.readPanelManager?.openReadPanel(data);
  }

  showTerminalStream(runId: string): void {
    this.terminalPanelManager.openTerminalStreamPanel(runId);
  }

  closeTerminalStreamPanel(runId: string): void {
    this.terminalPanelManager.closePanel(runId);
  }

  postTerminalChunk(chunk: string, chunkIndex: number, processId: string): void {
    this.terminalPanelManager.postChunk(chunk, chunkIndex, processId);
  }

  postStreamDone(processId: string, status: 'success' | 'failed' | 'interrupted'): void {
    this.terminalPanelManager.postStreamDone(processId, status);
  }
}
