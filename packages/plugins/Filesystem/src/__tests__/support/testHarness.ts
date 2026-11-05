/**
 * Real-kernel test harness.
 *
 * Every boot uses the standard kernel composition, the durable node storage
 * driver, and a fresh temporary workspace. Tests never construct a fake
 * filesystem unless they explicitly need to isolate memory behaviour.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudFileSystem,
  IBrudPlugin,
  IBrudToolsService,
  IPluginManagerService,
  IStorageDriver,
  IUniversalHistoryService,
  OperationResult,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import type { ServiceContext } from '../../../../../kernel/src/contracts/lifecycle.js';
import { FileSystemToken } from '../../../../../kernel/services/BrudFileSystem/descriptor/tokens.js';
import { BrudToolsToken } from '../../../../../kernel/services/BrudTools/descriptor/tokens.js';
import { PluginManagerToken } from '../../../../../kernel/services/PluginManager/contracts/tokens.js';
import { UniversalHistoryToken } from '../../../../../kernel/services/UniversalHistory/descriptor/tokens.js';
import { SHARED_MUTEX } from '../../coordinator/index.js';
import type { FilesystemRuntime } from '../../runtime.js';
import type { ExecuteTool } from '../../search/index.js';

export interface TestKernel {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly caller: ServiceContext;
  readonly fs: IBrudFileSystem;
  readonly history: IUniversalHistoryService;
  readonly tools: IBrudToolsService;
  readonly manager: IPluginManagerService;
  shutdown(): Promise<void>;
}

export interface BootTestKernelOptions {
  readonly prefix?: string;
  readonly plugins?: readonly IBrudPlugin[];
  /** Use a real SQLite file instead of the in-memory store. */
  readonly onDiskHistory?: boolean;
  /** Storage backend override; performance tests use the non-fsync driver. */
  readonly storageDriver?: IStorageDriver;
}

/** Boots the standard kernel against a fresh temporary workspace. */
export async function bootTestKernel(
  options: BootTestKernelOptions = {},
): Promise<TestKernel> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), options.prefix ?? 'brud-filesystem-')),
  );
  const kernel = createStandardKernel({
    ...(options.storageDriver === undefined ? {} : { storageDriver: options.storageDriver }),
    history: options.onDiskHistory === true
      ? { dbPath: join(root, '.brud', 'history', 'universal.db') }
      : { inMemory: true },
    ...(options.plugins === undefined ? {} : { initialPlugins: options.plugins }),
  });

  await kernel.boot({ workspaceRoot: root });

  const caller: ServiceContext = {
    callerId: 'test.filesystem',
    tier: 'core',
    workspaceRoot: root,
  };

  const fs = kernel.requestAccess(caller, FileSystemToken);
  const history = kernel.requestAccess(caller, UniversalHistoryToken);
  const tools = kernel.requestAccess(caller, BrudToolsToken);
  const manager = kernel.requestAccess(caller, PluginManagerToken);

  return {
    kernel,
    root,
    caller,
    fs,
    history,
    tools,
    manager,
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/** Builds the runtime a tool handler receives. */
export function createRuntime(
  kernel: TestKernel,
  executeTool?: ExecuteTool,
): FilesystemRuntime {
  return {
    getFileSystem: () => kernel.fs,
    getUniversalHistory: () => kernel.history,
    executeTool: executeTool ?? ((name, input) =>
      kernel.tools.executeTool(name, input, {
        workspaceRoot: kernel.root,
        callerId: kernel.caller.callerId,
      })),
    mutex: SHARED_MUTEX,
    workspaceRoot: kernel.root,
  };
}

/** Deterministic `search_files` stand-in returning the supplied paths. */
export function fakeSearch(paths: readonly string[]): ExecuteTool {
  return async (name: string): Promise<OperationResult> => {
    if (name !== 'search_files') {
      return { status: 'failed', error: `TOOL_NOT_FOUND: ${name}` };
    }

    return {
      status: 'success',
      data: {
        results: paths.map((path) => ({ path })),
        totalMatches: paths.length,
        truncated: false,
      },
    };
  };
}

/** Records every dispatched search payload and returns the supplied paths. */
export function recordingSearch(
  paths: readonly string[],
  calls: Array<{ name: string; input: unknown }>,
): ExecuteTool {
  return async (name: string, input: unknown): Promise<OperationResult> => {
    calls.push({ name, input });

    return {
      status: 'success',
      data: {
        results: paths.map((path) => ({ path })),
        totalMatches: paths.length,
        truncated: false,
      },
    };
  };
}

/** Returns `data.errors[0].code` for a failed tool result. */
export function errorCode(result: OperationResult): string | undefined {
  const data = result.data as {
    errors?: Array<{ code?: string }>;
  } | undefined;

  return data?.errors?.[0]?.code;
}

/** Returns `data` typed as the mutation envelope. */
export function mutationData(result: OperationResult): {
  files: Array<{ path: string; status: string; from?: string; to?: string }>;
  skipped: Array<{ path: string; reason: string; code?: string }>;
  errors: Array<{ code: string; message: string; path?: string }>;
  sessionId?: string;
  preState?: Array<{ path: string; status: string; content?: string; size?: number }>;
} {
  return result.data as {
    files: Array<{ path: string; status: string; from?: string; to?: string }>;
    skipped: Array<{ path: string; reason: string; code?: string }>;
    errors: Array<{ code: string; message: string; path?: string }>;
    sessionId?: string;
    preState?: Array<{ path: string; status: string; content?: string; size?: number }>;
  };
}