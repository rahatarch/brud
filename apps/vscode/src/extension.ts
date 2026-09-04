import * as vscode from 'vscode';
import { BrudSRViewProvider } from './providers/SurgicalViewProvider';
import { BrudCodePreviewProvider } from './providers/DiffPreviewProvider';
import { BrudMainWindowManager } from './providers/MainWindowProvider';
import { BrudStructurePanelManager } from './providers/StructurePanelProvider';
import { registerExecutePatchCommand } from './commands/executePatch';
import { BrudLogger } from './utils/logger';
import { WorkspaceHistoryStore, VSCodeFileSystem } from '@brud/vscode-adapter';

/**
 * Entry point for the Brud extension.
 * Orchestrates the registration of providers and commands.
 */
export function activate(context: vscode.ExtensionContext) {
  const logger = BrudLogger.getInstance();
  const previewProvider = new BrudCodePreviewProvider();

  const mainWindowManager = new BrudMainWindowManager(
    context.extensionUri,
  );

  const structurePanelManager = new BrudStructurePanelManager(
    context.extensionUri,
  );

  const provider = new BrudSRViewProvider(
    context.extensionUri,
    logger.channel,
    previewProvider,
    mainWindowManager,
    structurePanelManager,
  );

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

  // Register implementation-agnostic commands
  registerExecutePatchCommand(context);

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