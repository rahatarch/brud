import * as vscode from 'vscode';
import type { FileOperation } from '@brud/core';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { BrudDiffPreviewPanelManager } from './DiffPreviewPanelProvider';
import { WorkspaceResolver } from './services/WorkspaceResolver';
import { ExecutionCoordinator } from './services/ExecutionCoordinator';
import { ErrorReporter } from './services/ErrorReporter';
import { PanelManager } from './services/PanelManager';
import { ApplyPatchHandler } from './handlers/ApplyPatchHandler';
import { ExecuteCurrentFileHandler } from './handlers/ExecuteCurrentFileHandler';
import { ExecuteAllFilesHandler } from './handlers/ExecuteAllFilesHandler';
import { ExtractStructureHandler } from './handlers/ExtractStructureHandler';
import { ManagementHandler } from './handlers/ManagementHandler';
import { GetStartedHandler } from './handlers/GetStartedHandler';
import { PreviewPatchHandler } from './handlers/PreviewPatchHandler';
import { PreviewNextFileHandler } from './handlers/PreviewNextFileHandler';
import { PreviewPrevFileHandler } from './handlers/PreviewPrevFileHandler';
import { PreviewAllFilesHandler } from './handlers/PreviewAllFilesHandler';
import { RejectPreviewHandler } from './handlers/RejectPreviewHandler';
import { DonePreviewHandler } from './handlers/DonePreviewHandler';
import { DiffPreviewRouter } from './handlers/DiffPreviewRouter';

export class SurgicalViewDependencies {
  readonly services: {
    workspaceResolver: WorkspaceResolver;
    executionCoordinator: ExecutionCoordinator;
    errorReporter: ErrorReporter;
    panelManager: PanelManager;
  };

  readonly handlers: {
    applyPatchHandler: ApplyPatchHandler;
    executeCurrentFileHandler: ExecuteCurrentFileHandler;
    executeAllFilesHandler: ExecuteAllFilesHandler;
    extractStructureHandler: ExtractStructureHandler;
    managementHandler: ManagementHandler;
    getStartedHandler: GetStartedHandler;
    previewPatchHandler: PreviewPatchHandler;
    previewNextFileHandler: PreviewNextFileHandler;
    previewPrevFileHandler: PreviewPrevFileHandler;
    previewAllFilesHandler: PreviewAllFilesHandler;
    rejectPreviewHandler: RejectPreviewHandler;
    donePreviewHandler: DonePreviewHandler;
  };

  readonly router: {
    diffPreviewRouter: DiffPreviewRouter;
  };

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _outputChannel: vscode.OutputChannel,
    private readonly _previewProvider: BrudCodePreviewProvider,
    private readonly _mainWindowProvider: any,
    private readonly _structurePanelManager: any,
    private readonly _readPanelManager: any,
    private readonly _diffPreviewPanelManager: BrudDiffPreviewPanelManager,
    private readonly _unifiedResultsPanelManager: any,
    // State accessors — provided by the owner (SurgicalViewProvider)
    private readonly _getFileList: () => string[],
    private readonly _getCurrentFileIndex: () => number,
    private readonly _setCurrentFileIndex: (idx: number) => void,
    private readonly _getOperationsByFile: () => Map<string, FileOperation[]>,
    private readonly _setOperationsByFile: (map: Map<string, FileOperation[]>) => void,
    private readonly _setFileList: (list: string[]) => void,
    private readonly _getOriginalPrompt: () => string,
    private readonly _setOriginalPrompt: (val: string) => void,
    private readonly _getDiffPreviewSessionId: () => string | undefined,
    private readonly _setDiffPreviewSessionId: (id: string | undefined) => void,
    private readonly _getWebview: () => vscode.Webview | undefined,
    private readonly _getLastExecutionResult: () => { operations: { toolKind: string; data: any }[] } | null,
    private readonly _setLastExecutionResult: (val: { operations: { toolKind: string; data: any }[] } | null) => void,
    private readonly _clearFileList: () => void,
    private readonly _clearOperationsByFile: () => void,
    private readonly _resetCurrentFileIndex: () => void,
    private readonly _showPreviewForFile: (filePath: string) => Promise<void>,
  ) {
    // Services
    const workspaceResolver = new WorkspaceResolver();
    const executionCoordinator = new ExecutionCoordinator();
    const errorReporter = new ErrorReporter(
      () => this._getWebview(),
      () => this._unifiedResultsPanelManager,
      this._outputChannel,
    );
    const panelManager = new PanelManager(
      this._unifiedResultsPanelManager,
      this._diffPreviewPanelManager,
      this._mainWindowProvider,
      this._structurePanelManager,
      this._readPanelManager,
    );

    this.services = { workspaceResolver, executionCoordinator, errorReporter, panelManager };

    // Handlers
    const applyPatchHandler = new ApplyPatchHandler(
      this._outputChannel,
      errorReporter,
      panelManager,
      executionCoordinator,
      () => this._getWebview(),
      () => this._getLastExecutionResult(),
      (val) => { this._setLastExecutionResult(val); },
    );

    const executeCurrentFileHandler = new ExecuteCurrentFileHandler(
      this._outputChannel,
      panelManager,
      executionCoordinator,
      workspaceResolver,
      () => this._getFileList(),
      () => this._getCurrentFileIndex(),
      () => this._getOperationsByFile(),
      () => this._getOriginalPrompt(),
      () => this._getDiffPreviewSessionId(),
      (id) => { this._setDiffPreviewSessionId(id); },
      () => this._getWebview(),
      () => this._getLastExecutionResult(),
      (val) => { this._setLastExecutionResult(val); },
    );

    const executeAllFilesHandler = new ExecuteAllFilesHandler(
      this._outputChannel,
      panelManager,
      executionCoordinator,
      workspaceResolver,
      () => this._getFileList(),
      () => this._getCurrentFileIndex(),
      () => this._getOperationsByFile(),
      () => this._getOriginalPrompt(),
      () => this._getDiffPreviewSessionId(),
      (id) => { this._setDiffPreviewSessionId(id); },
      () => this._getWebview(),
      () => { this._clearFileList(); },
      () => { this._clearOperationsByFile(); },
      () => { this._resetCurrentFileIndex(); },
    );

    const extractStructureHandler = new ExtractStructureHandler(
      this._outputChannel,
      panelManager,
      errorReporter,
      () => this._getWebview(),
    );

    const managementHandler = new ManagementHandler();
    const getStartedHandler = new GetStartedHandler();

    const previewPatchHandler = new PreviewPatchHandler(
      this._outputChannel,
      errorReporter,
      panelManager,
      () => this._getWebview(),
      (val) => { this._setOriginalPrompt(val); },
      (map) => { this._setOperationsByFile(map); },
      (list) => { this._setFileList(list); },
      (idx) => { this._setCurrentFileIndex(idx); },
      () => this._getFileList(),
    );

    const previewNextFileHandler = new PreviewNextFileHandler(
      () => this._getFileList(),
      () => this._getCurrentFileIndex(),
      (idx) => { this._setCurrentFileIndex(idx); },
      async (filePath) => { await this._showPreviewForFile(filePath); },
    );

    const previewPrevFileHandler = new PreviewPrevFileHandler(
      () => this._getFileList(),
      () => this._getCurrentFileIndex(),
      (idx) => { this._setCurrentFileIndex(idx); },
      async (filePath) => { await this._showPreviewForFile(filePath); },
    );

    const previewAllFilesHandler = new PreviewAllFilesHandler(
      this._outputChannel,
      () => this._getFileList(),
      () => this._getOperationsByFile(),
      this._previewProvider,
      () => this._getWebview(),
    );

    const rejectPreviewHandler = new RejectPreviewHandler(
      panelManager,
      () => this._getDiffPreviewSessionId(),
      (list) => { this._setFileList(list); },
      (map) => { this._setOperationsByFile(map); },
      (idx) => { this._setCurrentFileIndex(idx); },
      (id) => { this._setDiffPreviewSessionId(id); },
      () => this._getWebview(),
    );

    const donePreviewHandler = new DonePreviewHandler(
      panelManager,
      () => this._getFileList(),
      () => this._getOperationsByFile(),
      () => this._getLastExecutionResult(),
      () => this._getWebview(),
      (list) => { this._setFileList(list); },
      (map) => { this._setOperationsByFile(map); },
      (idx) => { this._setCurrentFileIndex(idx); },
      (id) => { this._setDiffPreviewSessionId(id); },
    );

    this.handlers = {
      applyPatchHandler,
      executeCurrentFileHandler,
      executeAllFilesHandler,
      extractStructureHandler,
      managementHandler,
      getStartedHandler,
      previewPatchHandler,
      previewNextFileHandler,
      previewPrevFileHandler,
      previewAllFilesHandler,
      rejectPreviewHandler,
      donePreviewHandler,
    };

    // Routers
    const diffPreviewRouter = new DiffPreviewRouter(
      this._outputChannel,
      panelManager,
      executeCurrentFileHandler,
      executeAllFilesHandler,
      rejectPreviewHandler,
      donePreviewHandler,
      previewPrevFileHandler,
      previewNextFileHandler,
    );

    this.router = { diffPreviewRouter };
  }

  /** Wire the diff preview panel message handler to the DiffPreviewRouter. */
  wireHandlers(): void {
    this._diffPreviewPanelManager.setMessageHandler((msg) => {
      this.router.diffPreviewRouter.handle(msg);
    });
  }
}