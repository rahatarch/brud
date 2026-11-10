/**
 * Shared harness for the Phase 8 Reader goal verification.
 *
 * Every read exercised here runs through a real kernel, a real temporary
 * workspace, and the standard DurableNodeStorageDriver. The only test doubles
 * are candidate-list providers for governor boundary tests and the spying
 * wrappers around the real filesystem service.
 */
import { mkdtemp, mkdir, readFile as readHostFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import type { TestContext } from 'node:test';
import {
  BrudToolsToken,
  FileSystemToken,
  PluginManagerToken,
  UtilityToken,
  createStandardKernel,
} from '@brud/kernel';
import type {
  BrudKernel,
  IBrudFileSystem,
  IBrudPlugin,
  IBrudToolsService,
  OperationResult,
  PluginManagerService,
  ServiceContext,
} from '@brud/kernel';
import { searchPlugin } from '../../../Search/src/index.js';
import { readerPlugin } from '../plugin.js';
import type { ReadResult } from '../envelope.js';
import type { ReaderRuntime, ToolDispatchResult } from '../readEngine.js';
import type { ReaderUtilities } from '../readEngine.js';
import { toAbsolutePath, toWorkspacePath } from '../readEngine.js';

export const READER_PLUGIN_ID = 'akkhar-labs.plugin.reader';
export const SEARCH_PLUGIN_ID = 'akkhar-labs.plugin.search';
export const MiB = 1024 * 1024;

/** Booted kernel plus its real workspace and capability handles. */
export interface ReaderHarness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly caller: ServiceContext;
  readonly tools: IBrudToolsService;
  readonly fs: IBrudFileSystem;
  readonly manager: PluginManagerService;
  readonly utilities: ReaderUtilities;
  /** Executes a Reader tool through the real dispatch gate. */
  call(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<OperationResult>;
  /** Builds the runtime the pure Reader orchestrators accept. */
  runtime(executeTool?: ReaderRuntime['executeTool']): ReaderRuntime;
  write(relativePath: string, data: string | Uint8Array): Promise<string>;
  mkdir(relativePath: string): Promise<string>;
  link(relativePath: string, target: string): Promise<string>;
  hostPath(relativePath: string): string;
  cleanup(): Promise<void>;
}

async function makeRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Boots the standard kernel with Search and Reader activated over a real
 * temporary workspace. Cleanup is registered on the test context.
 */
export async function bootReaderKernel(
  context: TestContext,
  options: { readonly prefix?: string; readonly initialPlugins?: readonly IBrudPlugin[] } = {},
): Promise<ReaderHarness> {
  const root = await makeRoot(options.prefix ?? 'brud-reader-verify-');
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [searchPlugin, readerPlugin, ...(options.initialPlugins ?? [])],
  });

  await kernel.boot({ options: { workspaceRoot: root } });

  const caller: ServiceContext = {
    callerId: 'test.reader',
    tier: 'core',
    workspaceRoot: root,
  };
  const tools = kernel.requestAccess(caller, BrudToolsToken);
  const fs = kernel.requestAccess(caller, FileSystemToken);
  const manager = kernel.requestAccess(caller, PluginManagerToken) as PluginManagerService;
  const utilities = kernel.requestAccess(caller, UtilityToken) as ReaderUtilities;

  const hostPath = (relativePath: string): string => {
    if (isAbsolute(relativePath)) {
      return relativePath;
    }

    return join(root, relativePath);
  };

  const write = async (relativePath: string, data: string | Uint8Array): Promise<string> => {
    const absolute = hostPath(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    return absolute;
  };

  const mkdirp = async (relativePath: string): Promise<string> => {
    const absolute = hostPath(relativePath);
    await mkdir(absolute, { recursive: true });
    return absolute;
  };

  const link = async (relativePath: string, target: string): Promise<string> => {
    const absolute = hostPath(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await symlink(target, absolute);
    return absolute;
  };

  const call = (
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OperationResult> => tools.executeTool(name, input, {
    workspaceRoot: root,
    callerId: caller.callerId,
    permissions: [],
    ...(signal === undefined ? {} : { signal }),
  });

  const runtime = (executeTool?: ReaderRuntime['executeTool']): ReaderRuntime => ({
    fs,
    utilities,
    workspaceRoot: root,
    executeTool: executeTool ?? ((name, input, contextOverride): Promise<ToolDispatchResult> =>
      tools.executeTool(name, input, {
        workspaceRoot: root,
        callerId: caller.callerId,
        permissions: [],
        ...(contextOverride?.signal === undefined ? {} : { signal: contextOverride.signal }),
      })),
  });

  const cleanup = async (): Promise<void> => {
    await kernel.shutdown().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  };

  context.after(cleanup);

  return {
    kernel,
    root,
    caller,
    tools,
    fs,
    manager,
    utilities,
    call,
    runtime,
    write,
    mkdir: mkdirp,
    link,
    hostPath,
    cleanup,
  };
}

/** Converts an absolute or relative path into a workspace-relative path. */
export function normalizeWorkspacePath(root: string, candidate: string): string {
  const normalized = candidate.replace(/\\/gu, '/');

  if (!isAbsolute(normalized) && !/^[A-Za-z]:\//u.test(normalized)) {
    return normalized.replace(/^\.\//u, '');
  }

  const relativePath = relative(root, candidate).replace(/\\/gu, '/');

  return relativePath === '' ? '.' : relativePath;
}

/** Normalization options for legacy parity comparisons. */
export interface ParityNormalizeOptions {
  readonly sort?: boolean;
  readonly normalizeErrors?: boolean;
}

function sortKey(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Normalizes a read result for parity comparison.
 *
 * Absolute paths become workspace-relative, undefined-valued keys are dropped
 * by JSON serialization, line endings are deterministic, and (optionally) the
 * file and skip lists are sorted.
 */
export function normalizeForParity(
  result: ReadResult | Record<string, unknown>,
  root: string,
  options: ParityNormalizeOptions = {},
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  const files = Array.isArray(clone.files) ? clone.files as Record<string, unknown>[] : [];
  const skips = Array.isArray(clone.skips) ? clone.skips as Record<string, unknown>[] : [];

  const normalizedFiles = files.map((entry) => {
    const next: Record<string, unknown> = {
      ...entry,
      path: normalizeWorkspacePath(root, String(entry.path)),
    };

    if (typeof next.content === 'string') {
      next.content = next.content.replace(/\r\n/gu, '\n');
    }

    if (typeof next.importedFrom === 'string') {
      next.importedFrom = normalizeWorkspacePath(root, next.importedFrom);
    }

    return next;
  });

  const normalizedSkips = skips.map((entry) => {
    const next: Record<string, unknown> = {
      ...entry,
      path: normalizeWorkspacePath(root, String(entry.path)),
    };

    if (options.normalizeErrors !== false && typeof next.error === 'string') {
      next.error = '<error>';
    }

    return next;
  });

  if (options.sort === true) {
    normalizedFiles.sort((left, right) => sortKey(left.path).localeCompare(sortKey(right.path)));
    normalizedSkips.sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
  }

  clone.files = normalizedFiles;
  clone.skips = normalizedSkips;

  return clone;
}

/** Live counters and a controllable delay over the real filesystem service. */
export interface FileSystemProbe {
  readCalls: number;
  readPaths: string[];
  statCalls: number;
  existsCalls: number;
  readDirectoryCalls: number;
  inFlight: number;
  maxInFlight: number;
  delayMs: number;
  restore(): void;
}

/**
 * Wraps the real filesystem instance's read methods with counters.
 *
 * The Reader captured the same service instance at activation, so the probe
 * observes real reads without replacing the filesystem with a mock.
 */
export function instrumentFileSystem(fs: IBrudFileSystem): FileSystemProbe {
  const originalReadFile = fs.readFile.bind(fs);
  const originalStat = fs.stat.bind(fs);
  const originalExists = fs.exists.bind(fs);
  const originalReadDirectory = fs.readDirectory.bind(fs);

  const probe: FileSystemProbe = {
    readCalls: 0,
    readPaths: [],
    statCalls: 0,
    existsCalls: 0,
    readDirectoryCalls: 0,
    inFlight: 0,
    maxInFlight: 0,
    delayMs: 0,
    restore(): void {
      (fs as unknown as { readFile: typeof originalReadFile }).readFile = originalReadFile;
      (fs as unknown as { stat: typeof originalStat }).stat = originalStat;
      (fs as unknown as { exists: typeof originalExists }).exists = originalExists;
      (fs as unknown as { readDirectory: typeof originalReadDirectory }).readDirectory = originalReadDirectory;
    },
  };

  (fs as unknown as { readFile: (path: string) => Promise<Uint8Array> }).readFile = async (
    path: string,
  ): Promise<Uint8Array> => {
    probe.readCalls += 1;
    probe.readPaths.push(path);
    probe.inFlight += 1;
    probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);

    try {
      if (probe.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, probe.delayMs));
      }

      return await originalReadFile(path);
    } finally {
      probe.inFlight -= 1;
    }
  };

  (fs as unknown as { stat: (path: string) => ReturnType<typeof originalStat> }).stat = async (
    path: string,
  ) => {
    probe.statCalls += 1;

    return originalStat(path);
  };

  (fs as unknown as { exists: (path: string) => ReturnType<typeof originalExists> }).exists = async (
    path: string,
  ) => {
    probe.existsCalls += 1;

    return originalExists(path);
  };

  (fs as unknown as { readDirectory: (path: string) => ReturnType<typeof originalReadDirectory> }).readDirectory = async (
    path: string,
  ) => {
    probe.readDirectoryCalls += 1;

    return originalReadDirectory(path);
  };

  return probe;
}

/** A deterministic candidate-list dispatcher for governor boundary tests. */
export function fixedCandidates(
  candidates: readonly string[],
): ReaderRuntime['executeTool'] {
  return async (): Promise<ToolDispatchResult> => ({
    status: 'success',
    data: {
      results: candidates.map((path) => ({ path })),
      totalMatches: candidates.length,
      truncated: false,
    },
  });
}

/** A dispatcher that reports a search failure. */
export function failingCandidates(message = 'search exploded'): ReaderRuntime['executeTool'] {
  return async (): Promise<ToolDispatchResult> => ({
    status: 'failed',
    error: message,
    message,
  });
}

/** A dispatcher that returns duplicate paths and non-path entries. */
export function duplicateCandidates(
  paths: readonly string[],
): ReaderRuntime['executeTool'] {
  return async (): Promise<ToolDispatchResult> => ({
    status: 'success',
    data: {
      results: [
        ...paths.map((path) => ({ path })),
        ...paths.map((path) => ({ path })),
        { path: '' },
        { path: 42 },
        { notPath: true },
      ],
      totalMatches: paths.length,
    },
  });
}

/** Resolves after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects with a descriptive error when `promise` exceeds `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

let gcFunction: (() => void) | undefined;

/** Invokes the harness GC when it can be exposed; otherwise a no-op. */
export function tryGc(): void {
  if (gcFunction === undefined) {
    try {
      v8.setFlagsFromString('--expose-gc');
      gcFunction = vm.runInNewContext('gc') as () => void;
    } catch {
      gcFunction = () => undefined;
    }
  }

  try {
    gcFunction();
  } catch {
    // GC remains best-effort.
  }
}

/** Current heap usage in bytes. */
export function heapUsed(): number {
  return process.memoryUsage().heapUsed;
}

/** Best-of-N wall time for an async operation. */
export async function bestOfAsync(runs: number, operation: () => Promise<unknown>): Promise<number> {
  let best = Number.POSITIVE_INFINITY;

  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    await operation();
    const elapsed = performance.now() - start;

    if (elapsed < best) {
      best = elapsed;
    }
  }

  return best;
}

/** Reads a repository-relative file as text (used for source greps). */
export async function readRepositoryFile(relativePath: string): Promise<string> {
  const absolute = join(process.cwd(), relativePath);

  return readHostFile(absolute, 'utf8');
}

/** Creates `count` small text files in a directory. */
export async function writeManyFiles(
  harness: ReaderHarness,
  directory: string,
  count: number,
  body = 'x',
): Promise<void> {
  await harness.mkdir(directory);

  for (let index = 0; index < count; index += 1) {
    const name = `file-${String(index).padStart(5, '0')}.txt`;
    await harness.write(`${directory}/${name}`, body);
  }
}

export { toAbsolutePath, toWorkspacePath };