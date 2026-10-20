import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_SETTINGS,
  NodeFileSystem,
  NodeHistoryStore,
  bootCoreKernel,
  executeCommand,
  executeConditional,
  executeParallel,
  executeSequential,
  executeTerminalCommand,
} from '@brud/core';
import type { BrudSettings, FileSystem, HistoryStore, TerminalExecutor } from '@brud/core';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };

export interface McpWorkspace {
  readonly kernel: BrudKernel;
  readonly workspaceRoot: string;
  readonly fileSystem: FileSystem;
  readonly historyStore: HistoryStore;
  readonly settings: BrudSettings;
}

export function resolveWorkspaceRoot(candidate: string): string {
  const resolved = path.resolve(candidate);
  let real = resolved;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    real = resolved;
  }
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${real}`);
  }
  return real;
}

export function loadWorkspaceSettings(workspaceRoot: string): BrudSettings {
  const settingsPath = path.join(workspaceRoot, '.brud', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<BrudSettings>;
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function createTerminalExecutor(): TerminalExecutor {
  return {
    execute: executeTerminalCommand,
    executeCommand: (command, cwd, timeout, env) =>
      executeCommand(command, cwd, timeout, env),
    executeSequential: (commands, cwd, timeout, env, stopOnFailure) =>
      executeSequential(commands, cwd, timeout, env, stopOnFailure),
    executeParallel: (commands, cwd, timeout, env) =>
      executeParallel(commands, cwd, timeout, env),
    executeConditional: (conditional, cwd, timeout, env) =>
      executeConditional(conditional, cwd, timeout, env),
  } as TerminalExecutor;
}

export async function bootMcpWorkspace(workspaceCandidate: string): Promise<McpWorkspace> {
  const workspaceRoot = resolveWorkspaceRoot(workspaceCandidate);
  const fileSystem = new NodeFileSystem();
  const historyStore = new NodeHistoryStore(workspaceRoot, fileSystem);
  const settings = loadWorkspaceSettings(workspaceRoot);

  const kernel = await bootCoreKernel({
    fs: fileSystem,
    terminal: createTerminalExecutor(),
    history: historyStore,
    settings,
  });

  return { kernel, workspaceRoot, fileSystem, historyStore, settings };
}
