import type { UnifiedSessionResults, WebviewMessage } from '@brud/protocol';
import { SurgicalViewDependencies } from './SurgicalViewDependencies';

const EXECUTION_COMMANDS: ReadonlySet<string> = new Set([
  'applyPatch',
  'executeAllFiles',
  'executeCurrentFile',
]);

export class SurgicalViewRouter {
  private _isExecuting = false;

  constructor(
    private deps: SurgicalViewDependencies,
    private getLastExecutionResult: () => UnifiedSessionResults | null,
  ) {}

  async handle(data: WebviewMessage): Promise<void> {
    const isExecutionCommand = EXECUTION_COMMANDS.has(data.command);

    if (isExecutionCommand && this._isExecuting) {
      this.deps.services.errorReporter.sendError(
        'An operation is already in progress. Wait for the current execution to finish before starting another.',
      );
      return;
    }

    if (isExecutionCommand) {
      this._isExecuting = true;
    }

    try {
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
        case 'killProcess':
          if (data.processId) {
            this.deps.services.executionCoordinator.killActiveProcess(data.processId);
          }
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.services.errorReporter.sendError(`Operation failed: ${message}`);
    } finally {
      if (isExecutionCommand) {
        this._isExecuting = false;
      }
    }
  }
}
