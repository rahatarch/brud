import * as vscode from 'vscode';
import { BrudSRViewProvider } from './providers/SurgicalViewProvider';
import { BrudCodePreviewProvider } from './providers/DiffPreviewProvider';
import { registerExecutePatchCommand } from './commands/executePatch';
import { BrudLogger } from './utils/logger';

/**
 * Entry point for the Brud extension.
 * Orchestrates the registration of providers and commands.
 */
export function activate(context: vscode.ExtensionContext) {
  const logger = BrudLogger.getInstance();
  const previewProvider = new BrudCodePreviewProvider();

  const provider = new BrudSRViewProvider(
    context.extensionUri,
    logger.channel,
    previewProvider,
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

  // Register implementation-agnostic commands
  registerExecutePatchCommand(context);
}

export function deactivate() {}