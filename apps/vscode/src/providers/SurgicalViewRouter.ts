import type { WebviewMessage } from '@brud/protocol';
import { SurgicalViewDependencies } from './SurgicalViewDependencies';

export class SurgicalViewRouter {
  constructor(
    private deps: SurgicalViewDependencies,
    private getLastExecutionResult: () => { operations: { toolKind: string; data: any }[] } | null,
  ) {}

  async handle(data: WebviewMessage): Promise<void> {
    switch (data.command) {
      case 'applyPatch':
        await this.deps.handlers.applyPatchHandler.handle(data.text ?? '');
        break;
      case 'previewPatch':
        await this.deps.handlers.previewPatchHandler.handle(data.text ?? '');
        break;
      case 'previewNextFile':
        await this.deps.handlers.previewNextFileHandler.handle();
        break;
      case 'previewPrevFile':
        await this.deps.handlers.previewPrevFileHandler.handle();
        break;
      case 'previewAllFiles':
        await this.deps.handlers.previewAllFilesHandler.handle();
        break;
      case 'executeCurrentFile':
        await this.deps.handlers.executeCurrentFileHandler.handle(data.fileIndex);
        break;
      case 'executeAllFiles':
        await this.deps.handlers.executeAllFilesHandler.handle();
        break;
      case 'rejectPreview':
        await this.deps.handlers.rejectPreviewHandler.handle();
        break;
      case 'extractStructure':
        await this.deps.handlers.extractStructureHandler.handle(data.text ?? '');
        break;
      case 'openMainWindow':
        await this.deps.handlers.managementHandler.handle();
        break;
      case 'openPromptLibrary':
        await this.deps.handlers.managementHandler.handle();
        break;
      case 'openGetStarted':
        await this.deps.handlers.getStartedHandler.handle();
        break;
      case 'openUnifiedResults': {
        const result = this.getLastExecutionResult();
        if (result) {
          this.deps.services.panelManager.showUnifiedResults(result);
        }
        break;
      }
      case 'previewNoChanges':
        this.deps.services.panelManager.showNoPreview(
          'No changes found. The search text was not found in any of the files.',
        );
        break;
    }
  }
}