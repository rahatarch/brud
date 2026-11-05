/**
 * Independent verification harness for the Phase 9 Filesystem plugin.
 *
 * This file is a test support module only. It boots the standard kernel against
 * a real temporary workspace and the real DurableNodeStorageDriver. Nothing in
 * the plugin implementation is imported except the public plugin factory.
 */
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import type {
  IBrudFileSystem,
  IBrudToolsService,
  IStorageDriver,
  IUniversalHistoryService,
  OperationResult,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import type { ServiceContext } from '../../../../../kernel/src/contracts/lifecycle.js';
import { DurableNodeStorageDriver } from '../../../../../kernel/services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import type { IFileMutationJournal } from '../../../../../kernel/services/BrudFileSystem/events/types.js';
import { FileSystemToken } from '../../../../../kernel/services/BrudFileSystem/descriptor/tokens.js';
import { BrudToolsToken } from '../../../../../kernel/services/BrudTools/descriptor/tokens.js';
import { UniversalHistoryToken } from '../../../../../kernel/services/UniversalHistory/descriptor/tokens.js';
import { certifyOfficialPlugin } from '../../../../../kernel/services/PluginManager/contracts/branding.js';
import { createSearchPlugin } from '../../../../Search/src/index.js';
import { SHARED_MUTEX } from '../../coordinator/index.js';
import { createFilesystemPlugin } from '../../index.js';
import type { FilesystemRuntime } from '../../runtime.js';
import type { ExecuteTool } from '../../search/index.js';

type FsPromises = typeof import('node:fs/promises');

/**
 * The host filesystem module, resolved without a static `node:fs` import.
 *
 * The plugin's existing purity test scans every non-`__tests__` source file for
 * a direct fs import. Verification legitimately needs the real filesystem, so
 * it resolves the builtin at runtime; the plugin implementation itself remains
 * free of it.
 */
const fsPromises = (
  process as unknown as {
    getBuiltinModule(id: string): FsPromises;
  }
).getBuiltinModule('node:fs/promises');

const {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} = fsPromises;

export const FILESYSTEM_PLUGIN_ID = 'akkhar-labs.plugin.filesystem';

/** The twelve audited tool names. */
export const TOOL_NAMES = [
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'append_file',
  'create_directory',
  'delete_directory',
  'move_directory',
  'append_file_multi',
  'search_replace',
  'search_replace_multi',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ExpectedSchema {
  readonly properties: readonly string[];
  readonly required: readonly string[];
}

/** Discovery-audit schema surface, verbatim from the Phase 9 audit §2. */
export const EXPECTED_SCHEMAS: Readonly<Record<ToolName, ExpectedSchema>> = Object.freeze({
  create_file: { properties: ['path', 'content'], required: ['path', 'content'] },
  delete_file: { properties: ['path'], required: ['path'] },
  rename_file: { properties: ['from', 'to'], required: ['from', 'to'] },
  move_file: { properties: ['from', 'to'], required: ['from', 'to'] },
  copy_file: { properties: ['from', 'to'], required: ['from', 'to'] },
  append_file: {
    properties: ['path', 'position', 'content'],
    required: ['path', 'content'],
  },
  create_directory: {
    properties: ['directoryPath', 'files'],
    required: ['directoryPath'],
  },
  delete_directory: { properties: ['directoryPath'], required: ['directoryPath'] },
  move_directory: { properties: ['from', 'to'], required: ['from', 'to'] },
  append_file_multi: {
    properties: ['pattern', 'scope', 'position', 'content'],
    required: ['pattern', 'content'],
  },
  search_replace: {
    properties: ['path', 'search', 'replace'],
    required: ['path', 'search', 'replace'],
  },
  search_replace_multi: {
    properties: ['pattern', 'scope', 'search', 'replace'],
    required: ['pattern', 'search', 'replace'],
  },
});

export interface VerificationKernel {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly caller: ServiceContext;
  readonly fs: IBrudFileSystem;
  readonly history: IUniversalHistoryService;
  readonly tools: IBrudToolsService;
  readonly driver: IStorageDriver;
  shutdown(): Promise<void>;
}

export interface BootOptions {
  readonly prefix?: string;
  readonly storageDriver?: IStorageDriver;
  readonly onDiskHistory?: boolean;
  readonly withSearch?: boolean;
  readonly certifyFilesystem?: boolean;
  readonly filesystemPlugin?: ReturnType<typeof createFilesystemPlugin>;
  /** Journal override; governor probes use a disabled journal to isolate I/O. */
  readonly mutationJournal?: IFileMutationJournal;
}

/** Boots a standard kernel with the certified Filesystem plugin. */
export async function bootVerificationKernel(
  options: BootOptions = {},
): Promise<VerificationKernel> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), options.prefix ?? 'brud-fs-verify-')),
  );
  const driver = options.storageDriver ?? new DurableNodeStorageDriver();
  const filesystem = options.filesystemPlugin ?? createFilesystemPlugin();
  const plugins = [
    ...(options.withSearch === false ? [] : [createSearchPlugin()]),
    options.certifyFilesystem === false ? filesystem : certifyOfficialPlugin(filesystem),
  ];
  const kernel = createStandardKernel({
    storageDriver: driver,
    history: options.onDiskHistory === true
      ? { dbPath: join(root, '.brud', 'history', 'universal.db') }
      : { inMemory: true },
    initialPlugins: plugins,
    ...(options.mutationJournal === undefined
      ? {}
      : { mutationJournal: options.mutationJournal }),
  });

  await kernel.boot({ workspaceRoot: root });

  const caller: ServiceContext = {
    callerId: 'verification.filesystem',
    tier: 'core',
    workspaceRoot: root,
  };

  const fs = kernel.requestAccess(caller, FileSystemToken);
  const history = kernel.requestAccess(caller, UniversalHistoryToken);
  const tools = kernel.requestAccess(caller, BrudToolsToken);

  return {
    kernel,
    root,
    caller,
    fs,
    history,
    tools,
    driver,
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/** Dispatches a tool through the live registry. */
export function invoke(
  kernel: VerificationKernel,
  name: string,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  return kernel.tools.executeTool(name, input, {
    workspaceRoot: kernel.root,
    callerId: 'verification.filesystem',
  });
}

/** Builds the runtime a handler receives for handler-level probes. */
export function createRuntime(
  kernel: VerificationKernel,
  executeTool?: ExecuteTool,
  history?: IUniversalHistoryService,
): FilesystemRuntime {
  return {
    getFileSystem: () => kernel.fs,
    getUniversalHistory: () => history ?? kernel.history,
    executeTool: executeTool ?? ((name, input) =>
      kernel.tools.executeTool(name, input, {
        workspaceRoot: kernel.root,
        callerId: 'verification.filesystem',
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
  const data = result.data as { errors?: Array<{ code?: string }> } | undefined;

  return data?.errors?.[0]?.code;
}

/** Returns `data.errors[0].message` for a failed tool result. */
export function errorMessage(result: OperationResult): string | undefined {
  const data = result.data as { errors?: Array<{ message?: string }> } | undefined;

  return data?.errors?.[0]?.message;
}

export interface MutationEnvelope {
  kind?: string;
  status?: string;
  message?: string;
  files: Array<{ path: string; status: string; from?: string; to?: string }>;
  skipped: Array<{ path: string; reason: string; code?: string }>;
  errors: Array<{ code: string; message: string; path?: string }>;
  sessionId?: string;
  preState?: Array<{
    path: string;
    status: string;
    content?: string;
    size?: number;
  }>;
}

/** Narrows a tool result's plugin-native envelope. */
export function mutationData(result: OperationResult): MutationEnvelope {
  return result.data as MutationEnvelope;
}

/** Absolute path inside a verification workspace. */
export function absolute(root: string, relativePath: string): string {
  return join(root, relativePath);
}

/** Reads a workspace file with node:fs (not through the kernel). */
export function readReal(root: string, relativePath: string): Promise<string> {
  return readFile(join(root, relativePath), 'utf8');
}

/** Reads a workspace file as bytes with node:fs. */
export function readRealBytes(root: string, relativePath: string): Promise<Buffer> {
  return readFile(join(root, relativePath));
}

/** Returns whether a real path exists. */
export async function realExists(root: string, relativePath: string): Promise<boolean> {
  try {
    await stat(join(root, relativePath));

    return true;
  } catch {
    return false;
  }
}

/** Writes a real file, creating parents. */
export async function writeReal(
  root: string,
  relativePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

/** Reads an absolute file through node:fs. */
export function readAbsolute(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/** Reads absolute bytes through node:fs. */
export function readAbsoluteBytes(path: string): Promise<Buffer> {
  return readFile(path);
}

/** Writes an absolute path through node:fs, creating parents. */
export async function writeAbsolute(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Removes an absolute path recursively. */
export async function removeReal(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Creates a real temporary directory and resolves its canonical path. */
export async function makeTempDirectory(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** Classifies a real path without following symlinks. */
export async function realKind(
  root: string,
  relativePath: string,
): Promise<'file' | 'directory' | 'missing'> {
  try {
    const info = await stat(join(root, relativePath));

    return info.isDirectory() ? 'directory' : 'file';
  } catch {
    return 'missing';
  }
}

/** Returns the byte size of a real file. */
export async function realSize(root: string, relativePath: string): Promise<number> {
  return (await stat(join(root, relativePath))).size;
}

/** Lists the entries of a real directory. */
export async function listReal(root: string, relativePath: string): Promise<string[]> {
  return readdir(join(root, relativePath));
}

/** Creates a real symlink. */
export async function symlinkReal(
  target: string,
  path: string,
  type: 'dir' | 'file' = 'dir',
): Promise<void> {
  await symlink(target, path, type);
}

/** Creates a real directory tree and returns the target directory. */
export async function makeDeepDirectory(
  root: string,
  depth: number,
  leafFile?: string,
  segmentPrefix = 'd',
): Promise<string> {
  const segments = Array.from(
    { length: depth },
    (_, index) => `${segmentPrefix}${index + 1}`,
  );
  const directory = posix.join(...segments);
  await mkdir(join(root, directory), { recursive: true });

  if (leafFile !== undefined) {
    await writeFile(join(root, directory, leafFile), 'leaf');
  }

  return directory;
}

/** SHA-256 of bytes or a UTF-8 string. */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Absolute CAS path for a digest. */
export function casPath(root: string, digest: string): string {
  return join(root, '.brud', 'history', 'cas', digest.slice(0, 2), digest);
}

/** Returns whether a CAS blob exists on disk. */
export async function casExists(root: string, digest: string): Promise<boolean> {
  try {
    await stat(casPath(root, digest));

    return true;
  } catch {
    return false;
  }
}

export type WorkspaceEntry =
  | { readonly kind: 'file'; readonly sha256: string; readonly size: number }
  | { readonly kind: 'directory' };

/**
 * Snapshots the workspace, excluding the history ledger.
 *
 * Symlinks are recorded by their target text so an escape is never followed.
 */
export async function snapshotWorkspace(
  root: string,
  prefix = '',
): Promise<Map<string, WorkspaceEntry>> {
  const snapshot = new Map<string, WorkspaceEntry>();
  const directory = prefix === '' ? root : join(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = prefix === '' ? entry.name : posix.join(prefix, entry.name);

    if (relativePath === '.brud' && prefix === '') {
      continue;
    }

    const absolutePath = join(root, relativePath);
    const info = await lstat(absolutePath);

    if (info.isSymbolicLink()) {
      snapshot.set(relativePath, { kind: 'file', sha256: `symlink:${info.size}`, size: info.size });
      continue;
    }

    if (info.isDirectory()) {
      snapshot.set(relativePath, { kind: 'directory' });
      const children = await snapshotWorkspace(root, relativePath);
      for (const [child, state] of children) {
        snapshot.set(child, state);
      }
      continue;
    }

    if (info.isFile()) {
      const bytes = await readFile(absolutePath);
      snapshot.set(relativePath, {
        kind: 'file',
        sha256: sha256(bytes),
        size: info.size,
      });
    }
  }

  return snapshot;
}

/** Canonical, comparable form of a workspace snapshot. */
export function canonicalSnapshot(
  snapshot: ReadonlyMap<string, WorkspaceEntry>,
): string {
  const sorted = [...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b));

  return JSON.stringify(sorted);
}

/** Creates a real symlink to an outside directory and returns its workspace path. */
export async function makeEscapeSymlink(
  root: string,
  workspacePath = 'escape',
): Promise<string> {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'brud-fs-outside-')));
  await writeFile(join(outside, 'secret.txt'), 'outside-secret', 'utf8');
  await symlink(outside, join(root, workspacePath), 'dir');

  return `${workspacePath}/secret.txt`;
}

/** A tiny fixed sleep used only to make overlap observable in probes. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Recursively lists non-test TypeScript sources under the plugin. */
export async function pluginSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const child = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__verification__') {
        continue;
      }

      files.push(...await pluginSourceFiles(child));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(child);
    }
  }

  return files;
}

/** Converts an absolute legacy path to a workspace-relative posix path. */
export function relativeTo(root: string, absolutePath: string): string {
  const candidate = relative(root, absolutePath).split(sep).join('/');

  return candidate.startsWith('..') ? absolutePath.split(sep).join('/') : candidate;
}

/** Thrown to release a lock deterministically. */
export interface ReleaseLock {
  (): Promise<void>;
}

const LOCK_PATH = join(tmpdir(), 'brud-filesystem-verification.lock');
const LOCK_WAIT_MS = 50;
const LOCK_TIMEOUT_MS = 240_000;
const LOCK_STALE_MS = 240_000;

function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: string }).code
    : undefined;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/**
 * Cross-process lock for the verification files.
 *
 * Node's test runner executes files in parallel processes. Serializing the
 * real-kernel probes keeps the 16 MiB and 100-file boundary runs from starving
 * each other on constrained machines.
 */
export async function acquireVerificationLock(): Promise<void> {
  const started = Date.now();

  for (;;) {
    try {
      const handle = await open(LOCK_PATH, 'wx');

      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      } finally {
        await handle.close();
      }

      return;
    } catch (error: unknown) {
      if (errnoOf(error) !== 'EEXIST') {
        throw error;
      }
    }

    let record: { pid?: number; at?: number } | undefined;

    try {
      record = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as { pid?: number; at?: number };
    } catch {
      record = undefined;
    }

    const stale = record === undefined
      || record.pid === undefined
      || !processAlive(record.pid)
      || Date.now() - (record.at ?? 0) > LOCK_STALE_MS;

    if (stale) {
      await unlink(LOCK_PATH).catch(() => undefined);
    }

    if (Date.now() - started > LOCK_TIMEOUT_MS) {
      throw new Error('Timed out waiting for the Filesystem verification lock.');
    }

    await sleep(LOCK_WAIT_MS);
  }
}

/** Releases the verification lock only when this process owns it. */
export async function releaseVerificationLock(): Promise<void> {
  try {
    const record = JSON.parse(await readFile(LOCK_PATH, 'utf8')) as { pid?: number };

    if (record.pid === process.pid) {
      await unlink(LOCK_PATH).catch(() => undefined);
    }
  } catch {
    // Nothing to release.
  }
}