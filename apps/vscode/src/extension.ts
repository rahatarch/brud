import * as vscode from 'vscode';
import { BrudSRViewProvider } from './providers/SurgicalViewProvider';
import { BrudCodePreviewProvider } from './providers/DiffPreviewProvider';
import { BrudMainWindowManager } from './providers/MainWindowProvider';
import { BrudStructurePanelManager } from './providers/StructurePanelProvider';
import { BrudReadPanelManager } from './providers/ReadPanelProvider';
import { BrudDiffPreviewPanelManager } from './providers/DiffPreviewPanelProvider';
import { BrudTerminalPanelManager } from './providers/TerminalStreamPanelProvider';
import { BrudUnifiedResultsPanelManager } from './providers/UnifiedResultsPanelProvider';
import { BrudGetStartedManager } from './providers/GetStartedPanelProvider';
import { registerExecutePatchCommand } from './commands/executePatch';
import { BrudLogger } from './utils/logger';
import { WorkspaceHistoryStore, VSCodeFileSystem, getEffectiveSettings } from '@brud/vscode-adapter';
import { initializeToolRegistry } from '@brud/core';
import { startHttpServer } from '@brud/mcp';
import { McpServerService } from './mcp/McpServerService';

let mcpServiceRef: McpServerService | undefined;

async function readMcpAutoOn(root: string | undefined): Promise<boolean> {
  if (!root) {
    return false;
  }
  try {
    const { settings } = await getEffectiveSettings(root);
    return settings.mcpAutoOn !== false;
  } catch {
    return true;
  }
}

/**
 * Entry point for the Brud extension.
 * Orchestrates the registration of providers and commands.
 */
const PREFERRED_MCP_PORT = 8899;

export function activate(context: vscode.ExtensionContext) {
  // Initialize tool registry early so all providers and handlers can query it.
  // This must run before any webview can send a getToolList or GET_TOOL_INFO request.
  initializeToolRegistry();

  const logger = BrudLogger.getInstance();
  const previewProvider = new BrudCodePreviewProvider();

  const mcpService = new McpServerService({
    startServer: (root, options) =>
      startHttpServer(root, {
        ...(options?.preferredPort !== undefined ? { port: options.preferredPort } : {}),
      }),
    preferredPort: PREFERRED_MCP_PORT,
    getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    log: (message) => logger.appendLine(`[mcp] ${message}`),
  });
  mcpServiceRef = mcpService;

  const syncMcpWithWorkspace = async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const autoOn = await readMcpAutoOn(root);
    await mcpService.sync(autoOn);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void syncMcpWithWorkspace();
    }),
  );

  void syncMcpWithWorkspace();

  const mainWindowManager = new BrudMainWindowManager(
    context.extensionUri,
  );
  mainWindowManager.setMcpService(mcpService);

  const structurePanelManager = new BrudStructurePanelManager(
    context.extensionUri,
  );

  const readPanelManager = new BrudReadPanelManager(
    context.extensionUri,
  );

  const diffPreviewPanelManager = new BrudDiffPreviewPanelManager(
    context.extensionUri,
  );

  const terminalPanelManager = new BrudTerminalPanelManager(
    context.extensionUri,
  );

  const unifiedResultsPanelManager = new BrudUnifiedResultsPanelManager(
    context.extensionUri,
  );

  const getStartedManager = new BrudGetStartedManager(
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
    terminalPanelManager,
  );

  // Wire settings reload: after MainWindow saves settings, reload sidebar immediately
  mainWindowManager.setOnSettingsSaved(() => provider.loadSettings());

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

  // Register implementation-agnostic commands
  registerExecutePatchCommand(context);

  // Load settings
  provider.loadSettings().catch(err => {
    logger.appendLine(`[brud] Failed to load settings: ${err}`);
  });

  // Watch .brud/settings.json for changes with debounce to prevent race conditions
  const settingsWatcher = vscode.workspace.createFileSystemWatcher('**/.brud/settings.json');
  let reloadTimer: NodeJS.Timeout | undefined;
  const debouncedReload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      try {
        await provider.loadSettings();
        mcpServiceRef?.refreshSettings();
        await syncMcpWithWorkspace();
        logger.appendLine('[brud] Settings reloaded successfully from disk.');
      } catch (err) {
        logger.appendLine(`[brud] Failed to reload settings on change: ${err}`);
      }
    }, 150);
  };

  settingsWatcher.onDidChange(debouncedReload);
  settingsWatcher.onDidCreate(debouncedReload);
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

export async function deactivate(): Promise<void> {
  const service = mcpServiceRef;
  mcpServiceRef = undefined;
  if (service) {
    await service.dispose();
  }
}