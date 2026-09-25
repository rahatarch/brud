import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'vscode', '.env') });

import * as vscode from 'vscode';
import { BrudSRViewProvider } from './providers/SurgicalViewProvider';
import { BrudCodePreviewProvider } from './providers/DiffPreviewProvider';
import { BrudMainWindowManager } from './providers/MainWindowProvider';
import { BrudStructurePanelManager } from './providers/StructurePanelProvider';
import { BrudReadPanelManager } from './providers/ReadPanelProvider';
import { BrudDiffPreviewPanelManager } from './providers/DiffPreviewPanelProvider';
import { BrudUnifiedResultsPanelManager } from './providers/UnifiedResultsPanelProvider';
import { BrudGetStartedManager } from './providers/GetStartedPanelProvider';
import { StreamTestPanelProvider } from './providers/StreamTestPanelProvider';
import { registerExecutePatchCommand } from './commands/executePatch';
import { BrudLogger } from './utils/logger';
import { WorkspaceHistoryStore, VSCodeFileSystem, VSCodeSecretVault, VSCodeProviderStorage } from '@brud/vscode-adapter';
import { initializeToolRegistry } from '@brud/core';
import { ProviderRegistry } from '@brud/automation';

/**
 * Entry point for the Brud extension.
 * Orchestrates the registration of providers and commands.
 */
export async function activate(context: vscode.ExtensionContext) {
  // Initialize tool registry early so all providers and handlers can query it.
  // This must run before any webview can send a getToolList or GET_TOOL_INFO request.
  initializeToolRegistry();

  // Initialize the vault-backed provider registry
  const secretVault = new VSCodeSecretVault(context);
  const providerStorage = new VSCodeProviderStorage(context);
  const providerRegistry = new ProviderRegistry(secretVault, providerStorage);
  await providerRegistry.init();

  const logger = BrudLogger.getInstance();
  const previewProvider = new BrudCodePreviewProvider();

  const mainWindowManager = new BrudMainWindowManager(
    context.extensionUri,
    providerRegistry,
  );

  const structurePanelManager = new BrudStructurePanelManager(
    context.extensionUri,
  );

  const readPanelManager = new BrudReadPanelManager(
    context.extensionUri,
  );

  const diffPreviewPanelManager = new BrudDiffPreviewPanelManager(
    context.extensionUri,
  );

  const unifiedResultsPanelManager = new BrudUnifiedResultsPanelManager(
    context.extensionUri,
  );

  const getStartedManager = new BrudGetStartedManager(
    context.extensionUri,
  );

  const streamTestProvider = new StreamTestPanelProvider(
    context.extensionUri,
  );

  const provider = new BrudSRViewProvider(
    context.extensionUri,
    logger.channel,
    previewProvider,
    mainWindowManager,
    structurePanelManager,
    readPanelManager,
    diffPreviewPanelManager,
    unifiedResultsPanelManager,
    providerRegistry,
  );

  // Wire settings reload: after MainWindow saves settings, reload sidebar immediately
  mainWindowManager.setOnSettingsSaved(() => provider.loadSettings());

  // Wire sidebar webview for cross-panel vault broadcasts
  mainWindowManager.setSidebarWebview(() => (provider as any)._view?.webview);

  // Register the Virtual Document Provider for surgical diff previews
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      'brud-preview',
      previewProvider,
    ),
  );

  // Register the Sidebar Webview View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('brud-view', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register the command to open the main window
  context.subscriptions.push(
    vscode.commands.registerCommand('brud.openManagement', () => {
      mainWindowManager.openMainWindow();
    }),
  );

  // Register the command to open the Get Started panel
  context.subscriptions.push(
    vscode.commands.registerCommand('brud.getStarted', () => {
      getStartedManager.openGetStarted();
    }),
  );

  // Register the command to open the stream test panel
  context.subscriptions.push(
    vscode.commands.registerCommand('brud.streamTest', () => {
      streamTestProvider.open();
    }),
  );

  // Register implementation-agnostic commands
  registerExecutePatchCommand(context);

  // Load settings
  provider.loadSettings().catch(err => {
    logger.appendLine(`[brud] Failed to load settings: ${err}`);
  });

  // Watch .brud/settings.json for changes
  const settingsWatcher = vscode.workspace.createFileSystemWatcher('**/.brud/settings.json');
  settingsWatcher.onDidChange(async () => {
    await provider.loadSettings();
  });
  settingsWatcher.onDidCreate(async () => {
    await provider.loadSettings();
  });
  context.subscriptions.push(settingsWatcher);

  // Run retention cleanup on activation
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const fileSystem = new VSCodeFileSystem();
    const historyStore = new WorkspaceHistoryStore(workspaceRoot, fileSystem);
    historyStore.runRetentionCleanup().then(deleted => {
      if (deleted > 0) {
        logger.appendLine(`History cleanup: removed ${deleted} old session(s)`);
      }
    });
  }
}

export function deactivate() {}