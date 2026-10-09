import type { OperationHandler, OperationResult, ExecutionContext, BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { CoreTokens } from './tokens.js';
import { executeFileOperations } from '../file-operations/index.js';
import type { FileSystem } from '../types/filesystem.js';
import type { TerminalExecutor } from '../terminal/types.js';
import type { HistoryStore } from '../history/store.js';
import type { BrudSettings } from '../settings/types.js';
import { DEFAULT_SETTINGS } from '../settings/types.js';
import type { FileOperation } from '../types/patch.js';
import { StructureService } from '../services/structureService.js';

const LEGACY_KINDS: readonly string[] = [
  "search_replace", "create_file", "delete_file", "rename_file",
  "move_file", "copy_file", "append_file", "create_directory",
  "delete_directory", "move_directory", "extract_structure",
  "codebase_metadata", "search_files", "append_file_multi",
  "search_replace_multi", "read_file", "read_files", "read_directory",
  "terminal_interactive", "terminal_command", "get_tool_info",
];

export function createLegacyOperationHandler(kind: string): OperationHandler {
  return {
    kind,
    requiredCapabilities: [CoreTokens.FileSystem],
    metadata: { isOfficial: true, version: '0.1.0' },
    async execute(context: ExecutionContext, input: unknown): Promise<OperationResult> {
      const fs = context.resolve<FileSystem>(CoreTokens.FileSystem);

      let terminal: TerminalExecutor | undefined;
      try { terminal = context.resolve<TerminalExecutor>(CoreTokens.TerminalExecutor); } catch { }

      let history: HistoryStore | undefined;
      try { history = context.resolve<HistoryStore>(CoreTokens.HistoryStore); } catch { }

      let settings: BrudSettings = DEFAULT_SETTINGS;
      try { settings = context.resolve<BrudSettings>(CoreTokens.Settings); } catch { }

      const operation = { kind, index: "0", ...(input as Record<string, unknown>) } as FileOperation;
      const workspaceRoot = context.workspaceRoot;

      const READ_ONLY_KINDS = new Set([
        'codebase_metadata',
        'extract_structure',
        'read_file',
        'read_files',
        'read_directory',
        'search_files',
        'get_tool_info',
      ]);
      const historyArg = READ_ONLY_KINDS.has(kind) ? undefined : history;

      const legacyResult = await executeFileOperations(
        [operation],
        fs,
        [workspaceRoot],
        historyArg,
        undefined,
        terminal,
        undefined,
        undefined,
        settings,
      );

      return {
        status: legacyResult.success ? "success" : "failed",
        data: legacyResult as unknown,
        message: legacyResult.message,
        error: legacyResult.errors?.[0]
          ? String(legacyResult.errors[0])
          : undefined,
      };
    },
  };
}

export function registerCoreOperations(kernel: BrudKernel): void {
  for (const kind of LEGACY_KINDS) {
    kernel.operations.register(createLegacyOperationHandler(kind));
  }
}

export async function bootCoreKernel(options: {
  fs: FileSystem;
  terminal?: TerminalExecutor;
  history?: HistoryStore;
  settings?: BrudSettings;
}): Promise<BrudKernel> {
  const mod: { BrudKernel: new (options?: { maxCallDepth?: number }) => BrudKernel } = await import('@brud/kernel');
  const kernel = new mod.BrudKernel();

  kernel.services.register(CoreTokens.FileSystem, options.fs);
  if (options.terminal) {
    kernel.services.register(CoreTokens.TerminalExecutor, options.terminal);
  }
  if (options.history) {
    kernel.services.register(CoreTokens.HistoryStore, options.history);
  }
  if (options.settings) {
    kernel.services.register(CoreTokens.Settings, options.settings);
  }

  kernel.services.register(CoreTokens.StructureService, new StructureService(options.fs));

  registerCoreOperations(kernel);

  kernel.services.freeze();

  return kernel;
}