import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceHistoryStore, getWorkspaceFolders, VSCodeFileSystem, loadBrudSettings, saveBrudSettings, getEffectiveSettings, VSCodePromptStore, CascadingPromptStore, getGlobalPromptsDir, ensureBrudHomeDir } from '@brud/vscode-adapter';
import { mergeSettings, globalToolRegistry } from '@brud/core';
import { ProviderRegistry } from '@brud/automation';
import type { WebviewMessage, ExtensionMessage, HistorySessionResult, RevertHistoryData, SnapshotDataResult, SessionSnapshotsResult } from '@brud/protocol';
import { revertOperations, invalidRevertRequestError, type UserPrompt, type UserPromptVersion } from '@brud/core';
import { ProviderVaultHandler } from './handlers/ProviderVaultHandler';

export class BrudMainWindowManager {
  private _panel: vscode.WebviewPanel | undefined;
  private _historyStore: WorkspaceHistoryStore | undefined;
  private _promptStore: CascadingPromptStore | undefined;
  private _onSettingsSaved?: () => Promise<void>;
  private _providerVaultHandler?: ProviderVaultHandler;
  private _getSidebarWebview?: () => vscode.Webview | undefined;

  private _promptStoreInit: Promise<void>;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly providerRegistry: ProviderRegistry,
  ) {
    const folders = getWorkspaceFolders();
    if (folders.length > 0) {
      this._historyStore = new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem());
    }

    this._promptStoreInit = this._initPromptStore();
  }

  private async _initPromptStore(): Promise<void> {
    const fs = new VSCodeFileSystem();
    await ensureBrudHomeDir(fs);

    const globalDir = getGlobalPromptsDir();
    const globalStore = new VSCodePromptStore(globalDir, fs);

    const folders = getWorkspaceFolders();
    let workspaceStore: VSCodePromptStore;
    if (folders.length > 0) {
      const workspacePromptsDir = path.join(folders[0], '.brud', 'prompts');
      workspaceStore = new VSCodePromptStore(workspacePromptsDir, fs);
    } else {
      workspaceStore = new VSCodePromptStore('', fs);
    }

    this._promptStore = new CascadingPromptStore(globalStore, workspaceStore);
  }

  public setOnSettingsSaved(callback: () => Promise<void>): void {
    this._onSettingsSaved = callback;
  }

  public setSidebarWebview(getter: () => vscode.Webview | undefined): void {
    this._getSidebarWebview = getter;
  }

  public postMessage(message: any): void {
    if (this._panel) {
      this._panel.webview.postMessage(message);
    }
  }

  public openMainWindow(tab?: string, subView?: string): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      if (tab) {
        setTimeout(() => {
          this._panel?.webview.postMessage({
            command: 'setActiveTab',
            tab,
            subView,
          });
        }, 100);
      }
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'brud-main-window',
      'Brud Code Management',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview'),
        ],
      },
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._providerVaultHandler = new ProviderVaultHandler(
      this.providerRegistry,
      (msg) => {
        if (!this._panel) return Promise.resolve(false);
        const result = this._panel.webview.postMessage(msg);
        if (this._getSidebarWebview) {
          const sidebar = this._getSidebarWebview();
          if (sidebar) {
            sidebar.postMessage(msg);
          }
        }
        return result;
      },
    );

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    if (tab) {
      setTimeout(() => {
        this._panel?.webview.postMessage({
          command: 'setActiveTab',
          tab,
          subView,
        });
      }, 100);
    }

    this._panel.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      console.log('[MainWindowProvider] Received message:', data.command);
      switch (data.command) {
        case 'getHistory':
          await this._handleGetHistory();
          break;
        case 'getRevertHistory':
          await this._handleGetRevertHistory(data.sessionId);
          break;
        case 'revertSession':
          await this._handleRevertSession(data.sessionId, data.targetState);
          break;
        case 'revertOperations':
          await this._handleRevertOperations(data.sessionId, data.operationIds, data.targetState);
          break;
        case 'deleteSingleSession':
          await this._handleDeleteSingleSession(data.sessionId, data.triggeredBy);
          break;
        case 'softDeleteSession':
          await this._handleDeleteSingleSession(data.sessionId, data.triggeredBy);
          break;
        case 'getTrashedSessions':
          await this._handleGetTrashedSessions();
          break;
        case 'restoreSession':
          await this._handleRestoreSession(data.sessionId);
          break;
        case 'restoreAllSessions':
          await this._handleRestoreAllSessions();
          break;
        case 'permanentDelete':
          await this._handlePermanentDelete(data.sessionId);
          break;
        case 'wipeHistory':
          await this._handleWipeHistory();
          break;
        case 'getSessionSnapshots':
          await this._handleGetSessionSnapshots(data.sessionId);
          break;
        case 'getSettings':
          await this._handleGetSettings();
          break;
        case 'saveSettings':
          await this._handleSaveSettings(data.settings);
          break;
        case 'getToolList':
          await this._handleGetToolList();
          break;
        case 'getPrompts':
          await this._handleGetPrompts();
          break;
        case 'savePrompt':
          await this._handleSavePrompt(data);
          break;
        case 'deletePrompt':
          await this._handleDeletePrompt(data);
          break;
        case 'getPromptVersions':
          await this._handleGetPromptVersions(data);
          break;
        case 'revertPrompt':
          await this._handleRevertPrompt(data);
          break;
        case 'requestProviders':
        case 'selectModel':
        case 'saveProvider':
        case 'deleteProvider':
        case 'connectKey':
        case 'disconnectKey':
          if (this._providerVaultHandler) {
            await this._providerVaultHandler.handleMessage(data);
          }
          break;
      }
    });
  }

  private async _handleGetHistory(): Promise<void> {
    if (!this._historyStore) {
      this._panel?.webview.postMessage({ command: 'historyResult', history: [] } satisfies ExtensionMessage);
      return;
    }

    const sessions = await this._historyStore.getAllSessions();
    const history: HistorySessionResult[] = sessions.map(s => ({
      sessionId: s.sessionId,
      timestamp: s.timestamp,
      originalPrompt: s.originalPrompt,
      status: s.status,
      operationCount: s.operationCount,
      operationTypes: s.operationTypes,
      operations: s.operations,
      filesAffected: s.filesAffected,
      metadataUsed: s.metadataUsed,
      terminalCommands: s.terminalCommands,
      revertCommands: s.revertCommands,
      sessionTitle: s.sessionTitle,
      sessionDescription: s.sessionDescription,
    }));

    this._panel?.webview.postMessage({ command: 'historyResult', history } satisfies ExtensionMessage);
  }

  private async _handleGetRevertHistory(sessionId?: string): Promise<void> {
    if (!this._historyStore || !sessionId) {
      this._panel?.webview.postMessage({ command: 'revertHistoryResult', revertHistory: [] } satisfies ExtensionMessage);
      return;
    }

    const result = await this._historyStore.getRevertHistory(sessionId);
    const revertHistory: RevertHistoryData[] = result.reverts.map(r => ({
      revertId: r.revertId,
      timestamp: r.timestamp,
      targetState: r.targetState,
      revertedOperationIds: r.revertedOperationIds,
      status: r.status,
      errorMessage: r.errorMessage,
    }));

    this._panel?.webview.postMessage({ command: 'revertHistoryResult', revertHistory } satisfies ExtensionMessage);
  }

  private async _handleRevertSession(sessionId?: string, targetState?: 'pre' | 'post'): Promise<void> {
    const revertError = invalidRevertRequestError();
    if (!this._historyStore || !sessionId || !targetState) {
      this._panel?.webview.postMessage({
        command: 'revertResult',
        revertResult: { success: false, message: revertError.friendly, errors: [revertError.details] },
      } satisfies ExtensionMessage);
      return;
    }

    const result = await this._historyStore.revertSession(sessionId, targetState);
    this._panel?.webview.postMessage({ command: 'revertResult', revertResult: { ...result, errors: result.errors.map(e => e.details) } } satisfies ExtensionMessage);
  }

  private async _handleRevertOperations(sessionId?: string, operationIds?: string[], targetState?: 'pre' | 'post'): Promise<void> {
    const revertOpError = invalidRevertRequestError();
    if (!this._historyStore || !sessionId || !operationIds || !targetState) {
      this._panel?.webview.postMessage({
        command: 'revertOperationsResult',
        revertOperationsResult: { success: false, message: revertOpError.friendly, errors: [revertOpError.details] },
      } satisfies ExtensionMessage);
      return;
    }

    const result = await revertOperations(
      sessionId,
      operationIds,
      targetState,
      this._historyStore,
      this._historyStore['fileSystem'],
      getWorkspaceFolders(),
      (revertEntry) => {
        this._historyStore!.saveRevertHistory(sessionId, revertEntry).catch(() => {});
      },
    );
    this._panel?.webview.postMessage({ command: 'revertOperationsResult', revertOperationsResult: { ...result, errors: result.errors.map(e => e.details) } } satisfies ExtensionMessage);
  }

  private async _handleDeleteSingleSession(sessionId?: string, triggeredBy?: 'user' | 'system'): Promise<void> {
    if (!this._historyStore || !sessionId || !triggeredBy) {
      this._panel?.webview.postMessage({ command: 'sessionDeleted', deletedCount: 0 } satisfies ExtensionMessage);
      return;
    }

    const deletedCount = await this._historyStore.deleteSingleSession(sessionId, triggeredBy);
    this._panel?.webview.postMessage({ command: 'sessionDeleted', deletedCount } satisfies ExtensionMessage);
  }

  private async _handleGetTrashedSessions(): Promise<void> {
    if (!this._historyStore) {
      this._panel?.webview.postMessage({ command: 'trashedSessionsResult', trashedSessions: [] } satisfies ExtensionMessage);
      return;
    }

    const trashedSessions = await this._historyStore.getTrashedSessions();
    const trashed: HistorySessionResult[] = trashedSessions.map(s => ({
      sessionId: s.sessionId,
      timestamp: s.timestamp,
      originalPrompt: s.originalPrompt,
      status: s.status,
      operationCount: s.operationCount,
      operationTypes: s.operationTypes,
      operations: s.operations,
      filesAffected: s.filesAffected,
      metadataUsed: s.metadataUsed,
      terminalCommands: s.terminalCommands,
      revertCommands: s.revertCommands,
      sessionTitle: s.sessionTitle,
      sessionDescription: s.sessionDescription,
      isDeleted: s.isDeleted,
      deletedAt: s.deletedAt,
      expiresAt: s.expiresAt,
      deletedBy: s.deletedBy,
      deleteReason: s.deleteReason,
      renewedAt: s.renewedAt,
      softDeleteHistory: s.softDeleteHistory,
    }));

    this._panel?.webview.postMessage({ command: 'trashedSessionsResult', trashedSessions: trashed } satisfies ExtensionMessage);
  }

  private async _handleRestoreSession(sessionId?: string): Promise<void> {
    if (!this._historyStore || !sessionId) {
      return;
    }

    await this._historyStore.restoreSession(sessionId);
    this._panel?.webview.postMessage({ command: 'sessionRestored' } satisfies ExtensionMessage);
  }

  private async _handleRestoreAllSessions(): Promise<void> {
    if (!this._historyStore) {
      this._panel?.webview.postMessage({ command: 'allSessionsRestored', restoredCount: 0 } satisfies ExtensionMessage);
      return;
    }

    const trashedSessions = await this._historyStore.getTrashedSessions();
    let restoredCount = 0;
    for (const session of trashedSessions) {
      try {
        await this._historyStore.restoreSession(session.sessionId);
        restoredCount++;
      } catch {
        continue;
      }
    }
    this._panel?.webview.postMessage({ command: 'allSessionsRestored', restoredCount } satisfies ExtensionMessage);
  }

  private async _handlePermanentDelete(sessionId?: string): Promise<void> {
    if (!this._historyStore || !sessionId) {
      this._panel?.webview.postMessage({ command: 'sessionDeleted', deletedCount: 0 } satisfies ExtensionMessage);
      return;
    }

    const deletedCount = await this._historyStore.deleteSingleSession(sessionId, 'user', true);
    this._panel?.webview.postMessage({ command: 'sessionDeleted', deletedCount } satisfies ExtensionMessage);
  }

  private async _handleWipeHistory(): Promise<void> {
    if (!this._historyStore) {
      this._panel?.webview.postMessage({ command: 'historyWiped', deletedCount: 0, history: [] } satisfies ExtensionMessage);
      return;
    }

    const deletedCount = await this._historyStore.wipeAllHistory();
    this._panel?.webview.postMessage({ command: 'historyWiped', deletedCount, history: [] } satisfies ExtensionMessage);
  }

  private async _handleGetSessionSnapshots(sessionId?: string): Promise<void> {
    if (!this._historyStore || !sessionId) {
      this._panel?.webview.postMessage({ command: 'sessionSnapshotsResult', snapshotData: null } satisfies ExtensionMessage);
      return;
    }

    const entry = await this._historyStore.getSession(sessionId);
    if (!entry) {
      this._panel?.webview.postMessage({ command: 'sessionSnapshotsResult', snapshotData: null } satisfies ExtensionMessage);
      return;
    }

    const preSnapshot: SnapshotDataResult = {
      sessionId: entry.preSnapshot.sessionId,
      snapshotType: 'pre',
      files: Object.fromEntries(entry.preSnapshot.files),
      diffFromPrevious: entry.preSnapshot.diffFromPrevious,
    };

    const postSnapshot: SnapshotDataResult = {
      sessionId: entry.postSnapshot.sessionId,
      snapshotType: 'post',
      files: Object.fromEntries(entry.postSnapshot.files),
      diffFromPrevious: entry.postSnapshot.diffFromPrevious,
    };

    this._panel?.webview.postMessage({
      command: 'sessionSnapshotsResult',
      snapshotData: { pre: preSnapshot, post: postSnapshot },
    } satisfies ExtensionMessage);
  }

  private async _handleGetSettings(): Promise<void> {
    console.log('[MainWindowProvider] Handling getSettings');
    try {
      const folders = getWorkspaceFolders();
      console.log('[MainWindowProvider] Workspace folders:', folders.length);
      if (folders.length === 0) {
        console.log('[MainWindowProvider] No workspace folders, using defaults');
        this._panel?.webview.postMessage({
          command: 'settingsResult',
          settings: { workspaceBoundaryEnabled: true, toolAllowList: {} },
          source: 'default',
          warnings: [],
        } satisfies ExtensionMessage);
        return;
      }
      const result = await getEffectiveSettings(folders[0]);
      console.log('[MainWindowProvider] Loaded settings, source:', result.source);
      this._panel?.webview.postMessage({
        command: 'settingsResult',
        settings: result.settings,
        source: result.source,
        warnings: result.warnings,
      } satisfies ExtensionMessage);
    } catch (error) {
      console.error('[MainWindowProvider] Failed to load settings:', error);
      this._panel?.webview.postMessage({
        command: 'settingsResult',
        settings: { workspaceBoundaryEnabled: true, toolAllowList: {} },
        source: 'default',
        warnings: ['Failed to load settings: ' + String(error)],
      } satisfies ExtensionMessage);
    }
  }

  private async _handleGetToolList(): Promise<void> {
    const allTools = globalToolRegistry.getAllTools();
    const tools = allTools.map(t => ({
      kind: t.kind,
      name: t.name,
      description: t.description,
    }));
    this._panel?.webview.postMessage({ command: 'toolListResult', tools } satisfies ExtensionMessage);
  }

  private async _handleSaveSettings(settings?: Record<string, any>): Promise<void> {
    const folders = getWorkspaceFolders();
    if (folders.length === 0 || !settings) {
      return;
    }
    await saveBrudSettings(folders[0], settings);
    console.log('[MainWindowProvider] Settings saved to disk, reloading sidebar settings...');
    await this._onSettingsSaved?.();
    this._panel?.webview.postMessage({
      command: 'settingsSaved',
    } satisfies ExtensionMessage);
  }

  private async _handleGetPrompts(): Promise<void> {
    await this._promptStoreInit;
    if (!this._promptStore) {
      this._panel?.webview.postMessage({ command: 'promptsResult', prompts: [] } satisfies ExtensionMessage);
      return;
    }
    const prompts = await this._promptStore.list();
    this._panel?.webview.postMessage({ command: 'promptsResult', prompts } satisfies ExtensionMessage);
  }

  private async _handleSavePrompt(data: WebviewMessage): Promise<void> {
    await this._promptStoreInit;
    if (!this._promptStore || !data.promptData) {
      this._panel?.webview.postMessage({ command: 'promptSaved', savedPromptId: undefined, errorMessage: 'No prompt data provided' } satisfies ExtensionMessage);
      return;
    }
    const prompt = data.promptData as UserPrompt;
    await this._promptStore.save(prompt);
    this._panel?.webview.postMessage({ command: 'promptSaved', savedPromptId: prompt.id } satisfies ExtensionMessage);
  }

  private async _handleDeletePrompt(data: WebviewMessage): Promise<void> {
    await this._promptStoreInit;
    if (!this._promptStore || !data.promptId) {
      return;
    }
    await this._promptStore.delete(data.promptId);
    this._panel?.webview.postMessage({ command: 'promptDeleted', savedPromptId: data.promptId } satisfies ExtensionMessage);
  }

  private async _handleGetPromptVersions(data: WebviewMessage): Promise<void> {
    await this._promptStoreInit;
    if (!this._promptStore || !data.promptId) {
      this._panel?.webview.postMessage({ command: 'promptVersionsResult', versions: [] } satisfies ExtensionMessage);
      return;
    }
    const prompt = await this._promptStore.get(data.promptId);
    if (!prompt) {
      this._panel?.webview.postMessage({ command: 'promptVersionsResult', versions: [] } satisfies ExtensionMessage);
      return;
    }
    this._panel?.webview.postMessage({ command: 'promptVersionsResult', versions: prompt.versions } satisfies ExtensionMessage);
  }

  private async _handleRevertPrompt(data: WebviewMessage): Promise<void> {
    await this._promptStoreInit;
    if (!this._promptStore || !data.promptId || data.version === undefined) {
      this._panel?.webview.postMessage({ command: 'promptReverted', savedPromptId: undefined, errorMessage: 'Invalid revert request' } satisfies ExtensionMessage);
      return;
    }
    const prompt = await this._promptStore.get(data.promptId);
    if (!prompt) {
      this._panel?.webview.postMessage({ command: 'promptReverted', savedPromptId: undefined, errorMessage: 'Prompt not found' } satisfies ExtensionMessage);
      return;
    }
    const targetVersion = prompt.versions.find(v => v.version === data.version);
    if (!targetVersion) {
      this._panel?.webview.postMessage({ command: 'promptReverted', savedPromptId: undefined, errorMessage: 'Version not found' } satisfies ExtensionMessage);
      return;
    }
    const newVersion: UserPromptVersion = {
      version: prompt.currentVersion + 1,
      content: targetVersion.content,
      timestamp: new Date().toISOString(),
      message: `Reverted to version ${targetVersion.version}`,
    };
    prompt.versions.push(newVersion);
    prompt.currentVersion = newVersion.version;
    prompt.updatedAt = newVersion.timestamp;
    await this._promptStore.save(prompt);
    this._panel?.webview.postMessage({ command: 'promptReverted', savedPromptId: prompt.id } satisfies ExtensionMessage);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '');
    html = html.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/g, '');

    const assetRegex = /(?:src|href)="(\.\/(?:assets|images)\/[^"]+)"/g;
    html = html.replace(assetRegex, (match, assetPath) => {
      const assetUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', assetPath.replace('./', ''));
      const webviewUri = webview.asWebviewUri(assetUri);
      return match.replace(assetPath, webviewUri.toString());
    });

    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'images', 'brud_compressed_high.png')
    );
    html = html.replace('<div id="root">', `<div id="root" data-view-mode="main-window" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}