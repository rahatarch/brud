import { posix, win32 } from 'node:path';
import {
  buildBinaryEntry,
  buildReadResult,
  buildSkipEntry,
  buildTextEntry,
  clampEntriesToBudget,
  LineRangeError,
} from './envelope.js';
import type {
  ReadFileEntry,
  ReadLimitHit,
  ReadResult,
  ReadSkipEntry,
} from './envelope.js';
import {
  BINARY_SNIFF_BYTES,
  ByteBudget,
  DEFAULT_MAX_BYTES,
  MAX_CONCURRENCY,
  assertBatchLimit,
  isExcludedPath,
  mapInChunks,
  splitCommaList,
} from './governor.js';
import type {
  ReadDirectoryInput,
  ReadFileInput,
  ReadFilesInput,
} from './schemas.js';

/** Read-only directory entry projection. */
export interface ReaderDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

/** Read-only file metadata projection. */
export interface ReaderStat {
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

/** Filesystem surface the Reader needs from the plugin context. */
export interface ReaderFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  readDirectory(path: string): Promise<readonly ReaderDirectoryEntry[]>;
  stat(path: string): Promise<ReaderStat | null>;
  exists(path: string): Promise<boolean>;
}

/** Named options accepted by the utility resolver. */
export interface ReaderResolveImportsOptions {
  readonly filePath: string;
  readonly fileExists: (path: string) => boolean | Promise<boolean>;
  readonly customPatterns?: readonly string[];
}

/** Pure utility surface the Reader needs. */
export interface ReaderUtilities {
  resolveImports(content: string, options: ReaderResolveImportsOptions): Promise<string[]>;
}

/** Minimal dispatch result shape returned by `executeTool`. */
export interface ToolDispatchResult {
  readonly status: string;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly message?: string;
}

/** Runtime dependencies captured during plugin activation. */
export interface ReaderRuntime {
  readonly fs: ReaderFileSystem;
  readonly utilities: ReaderUtilities;
  readonly workspaceRoot: string;
  readonly executeTool: (
    name: string,
    input: Record<string, unknown>,
    contextOverride?: { readonly signal?: AbortSignal },
  ) => Promise<ToolDispatchResult>;
  readonly signal?: AbortSignal;
}

/** Raised when a required input field is missing or malformed. */
export class ReadInputError extends Error {
  public readonly code = 'INVALID_FIELD' as const;

  public readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ReadInputError';
    this.field = field;
  }
}

/** Raised when the Search tool does not complete successfully. */
export class SearchExecutionError extends Error {
  public readonly code = 'SEARCH_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SearchExecutionError';
  }
}

const SKIP_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', '.git', '.svn', '.hg', '.next',
  '.nuxt', 'out', '.cache', '__pycache__', '.yarn', '.pnp',
]);

function toPosix(value: string): string {
  return value.replace(/\\/gu, '/');
}

function isWindowsAbsolute(value: string): boolean {
  return /^[A-Za-z]:\//u.test(value) || value.startsWith('//');
}

/** Reports whether a user path is absolute on POSIX or Windows. */
export function isAbsolutePath(value: string): boolean {
  const normalized = toPosix(value);

  return normalized.startsWith('/') || isWindowsAbsolute(normalized);
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/u, '') : value;
}

function normalizeRelative(value: string): string {
  let normalized = toPosix(value);

  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  normalized = normalized.replace(/\/+$/u, '');

  return normalized === '.' ? '' : normalized;
}

/**
 * Converts a user path into the kernel-relative form.
 *
 * Absolute paths inside the workspace become relative. Absolute paths outside
 * it are preserved so the filesystem's containment authority produces the
 * canonical violation instead of the Reader re-implementing it.
 */
export function toWorkspacePath(userPath: string, workspaceRoot: string): string {
  const normalized = toPosix(userPath);

  if (!isAbsolutePath(normalized)) {
    return normalizeRelative(normalized);
  }

  const root = trimTrailingSlash(toPosix(workspaceRoot));
  const relative = isWindowsAbsolute(normalized) || isWindowsAbsolute(root)
    ? win32.relative(root, normalized)
    : posix.relative(root, normalized);
  const kernelPath = normalizeRelative(relative);

  if (kernelPath === '..' || kernelPath.startsWith('../')) {
    return normalized;
  }

  return kernelPath;
}

/** Resolves a kernel-relative path against the workspace root. */
export function toAbsolutePath(workspacePath: string, workspaceRoot: string): string {
  const root = toPosix(workspaceRoot);
  const relative = normalizeRelative(workspacePath);

  if (relative === '') {
    return root;
  }

  return isWindowsAbsolute(root)
    ? win32.resolve(root, relative)
    : posix.resolve(root, relative);
}

function joinWorkspacePath(directory: string, child: string): string {
  return normalizeRelative(directory === '' ? child : `${directory}/${child}`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ReadInputError(field, `The field "${field}" must be a string.`);
  }

  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field);

  if (text.length === 0) {
    throw new ReadInputError(field, `The field "${field}" must not be empty.`);
  }

  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asOptionalPositiveInteger(value: unknown): number | undefined {
  const parsed = asOptionalNumber(value);

  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }

  return fallback;
}

function normalizeMaxDepth(value: unknown): number {
  const parsed = asOptionalNumber(value);

  if (parsed === undefined || parsed <= 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;

  return typeof code === 'string' ? code : undefined;
}

function isPathViolation(error: unknown): boolean {
  const code = errorCodeOf(error);

  return code === 'WORKSPACE_PATH_VIOLATION'
    || code === 'WORKSPACE_CONFIGURATION_INVALID'
    || code === 'WORKSPACE_NOT_INITIALIZED';
}

/**
 * Sniffs the leading bytes for binary content.
 *
 * The first {@link BINARY_SNIFF_BYTES} bytes are inspected; a null byte or any
 * byte above the ASCII range marks the sample binary.
 */
export function isBinaryBytes(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  let hasHighByte = false;

  for (let index = 0; index < sampleLength; index++) {
    const byte = bytes[index]!;

    if (byte === 0) {
      return true;
    }

    if (byte > 0x7F) {
      hasHighByte = true;
    }
  }

  if (!hasHighByte) {
    return false;
  }

  const sample = bytes.subarray(0, sampleLength);

  return Buffer.from(sample).toString('utf8').includes('\uFFFD');
}

function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

interface RootReadResult {
  readonly entries: ReadFileEntry[];
  readonly skips: ReadSkipEntry[];
  readonly text?: string;
  readonly binary: boolean;
}

async function readRoot(
  runtime: ReaderRuntime,
  filePath: string,
  options: { readonly startLine?: number; readonly endLine?: number },
): Promise<RootReadResult> {
  try {
    const bytes = await runtime.fs.readFile(filePath);

    if (isBinaryBytes(bytes)) {
      return {
        entries: [buildBinaryEntry(filePath, bytes.byteLength)],
        skips: [buildSkipEntry(filePath, 'binary')],
        binary: true,
      };
    }

    const text = decodeUtf8(bytes);
    const entry = buildTextEntry(filePath, text, options);

    return { entries: [entry], skips: [], text, binary: false };
  } catch (error: unknown) {
    if (isPathViolation(error) || error instanceof LineRangeError) {
      throw error;
    }

    return {
      entries: [],
      skips: [buildSkipEntry(filePath, 'unreadable', messageOf(error))],
      binary: false,
    };
  }
}

interface ImportOptions {
  readonly excludePatterns?: readonly string[];
  readonly importSyntax?: string;
}

async function followImports(
  runtime: ReaderRuntime,
  rootPath: string,
  rootContent: string,
  maxDepth: number,
  options: ImportOptions,
  entries: ReadFileEntry[],
  skips: ReadSkipEntry[],
  visited: Set<string>,
): Promise<void> {
  const effectiveDepth = maxDepth <= 0 ? Number.POSITIVE_INFINITY : maxDepth;

  const walk = async (
    content: string,
    currentPath: string,
    remainingDepth: number,
  ): Promise<void> => {
    if (runtime.signal?.aborted || remainingDepth <= 0) {
      return;
    }

    const resolved = await runtime.utilities.resolveImports(content, {
      filePath: toAbsolutePath(currentPath, runtime.workspaceRoot),
      fileExists: async (candidate: string): Promise<boolean> => {
        try {
          return await runtime.fs.exists(candidate);
        } catch {
          return false;
        }
      },
      ...(options.importSyntax === undefined
        ? {}
        : { customPatterns: [options.importSyntax] }),
    });

    for (const importedPath of resolved) {
      if (runtime.signal?.aborted) {
        return;
      }

      const kernelPath = toWorkspacePath(importedPath, runtime.workspaceRoot);

      if (visited.has(kernelPath)) {
        continue;
      }

      visited.add(kernelPath);

      if (isExcludedPath(kernelPath, options.excludePatterns)) {
        continue;
      }

      let bytes: Uint8Array;

      try {
        bytes = await runtime.fs.readFile(kernelPath);
      } catch (error: unknown) {
        skips.push(buildSkipEntry(kernelPath, 'unreadable', messageOf(error)));
        continue;
      }

      if (isBinaryBytes(bytes)) {
        entries.push(buildBinaryEntry(kernelPath, bytes.byteLength, {
          isImported: true,
          importedFrom: rootPath,
        }));
        skips.push(buildSkipEntry(kernelPath, 'binary'));
        continue;
      }

      const text = decodeUtf8(bytes);
      entries.push(buildTextEntry(kernelPath, text, {
        isImported: true,
        importedFrom: rootPath,
      }));

      await walk(text, kernelPath, remainingDepth - 1);
    }
  };

  await walk(rootContent, rootPath, effectiveDepth);
}

interface CandidateOptions extends ImportOptions {
  readonly isImportRead: boolean;
  readonly maxDepth: number;
  readonly startLine?: number;
  readonly endLine?: number;
}

interface CandidateReadResult {
  readonly entries: ReadFileEntry[];
  readonly skips: ReadSkipEntry[];
}

async function readImportRoot(
  runtime: ReaderRuntime,
  candidate: string,
  options: CandidateOptions,
): Promise<CandidateReadResult> {
  const root = await readRoot(runtime, candidate, {});
  const entries = [...root.entries];
  const skips = [...root.skips];

  if (!root.binary && root.text !== undefined && !runtime.signal?.aborted) {
    const visited = new Set<string>([candidate]);

    await followImports(
      runtime,
      candidate,
      root.text,
      normalizeMaxDepth(options.maxDepth),
      {
        ...(options.excludePatterns === undefined
          ? {}
          : { excludePatterns: options.excludePatterns }),
        ...(options.importSyntax === undefined
          ? {}
          : { importSyntax: options.importSyntax }),
      },
      entries,
      skips,
      visited,
    );
  }

  return { entries, skips };
}

async function readCandidates(
  runtime: ReaderRuntime,
  candidates: readonly string[],
  options: CandidateOptions,
): Promise<ReadResult> {
  assertBatchLimit(candidates.length);

  const skips: ReadSkipEntry[] = [];
  const included: string[] = [];

  for (const candidate of candidates) {
    if (isExcludedPath(candidate, options.excludePatterns)) {
      skips.push(buildSkipEntry(candidate, 'excluded'));
    } else {
      included.push(candidate);
    }
  }

  const budget = new ByteBudget(DEFAULT_MAX_BYTES);
  const admitted: string[] = [];
  let truncated = false;
  let limitHit: ReadLimitHit | undefined;

  for (const candidate of included) {
    if (runtime.signal?.aborted) {
      break;
    }

    let size: number | undefined;

    try {
      const stats = await runtime.fs.stat(candidate);

      if (stats !== null && Number.isFinite(stats.size) && stats.size >= 0) {
        size = stats.size;
      }
    } catch (error: unknown) {
      if (isPathViolation(error)) {
        throw error;
      }
    }

    if (size !== undefined && !budget.tryAdmit(size)) {
      truncated = true;
      limitHit = 'bytes';
      break;
    }

    admitted.push(candidate);
  }

  const outcomes = await mapInChunks(
    admitted,
    async (candidate: string): Promise<CandidateReadResult> => (
      options.isImportRead
        ? readImportRoot(runtime, candidate, options)
        : readRoot(runtime, candidate, {
            ...(options.startLine === undefined ? {} : { startLine: options.startLine }),
            ...(options.endLine === undefined ? {} : { endLine: options.endLine }),
          })
    ),
    MAX_CONCURRENCY,
    runtime.signal,
  );

  const entries: ReadFileEntry[] = [];

  for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index];

    if (outcome === undefined) {
      continue;
    }

    if (outcome.error !== undefined) {
      if (isPathViolation(outcome.error) || outcome.error instanceof LineRangeError) {
        throw outcome.error;
      }

      skips.push(buildSkipEntry(
        admitted[index]!,
        'unreadable',
        messageOf(outcome.error),
      ));
      continue;
    }

    if (outcome.value === undefined) {
      continue;
    }

    entries.push(...outcome.value.entries);
    skips.push(...outcome.value.skips);
  }

  const clamped = clampEntriesToBudget(entries, DEFAULT_MAX_BYTES);

  if (clamped.exceeded) {
    truncated = true;
    limitHit = 'bytes';
  }

  return buildReadResult(clamped.entries, skips, truncated, limitHit);
}

/** Executes `read_file`. */
export async function readFile(
  runtime: ReaderRuntime,
  input: ReadFileInput,
): Promise<ReadResult> {
  const requestedPath = requireNonEmptyString(input.filePath, 'filePath');
  const filePath = toWorkspacePath(requestedPath, runtime.workspaceRoot);
  const startLine = asOptionalNumber(input.startLine);
  const endLine = asOptionalNumber(input.endLine);

  const root = await readRoot(runtime, filePath, {
    ...(startLine === undefined ? {} : { startLine }),
    ...(endLine === undefined ? {} : { endLine }),
  });

  const entries = [...root.entries];
  const skips = [...root.skips];
  const isImportRead = asBoolean(input.isImportRead, false);

  if (isImportRead && !root.binary && root.text !== undefined) {
    const visited = new Set<string>([filePath]);

    await followImports(
      runtime,
      filePath,
      root.text,
      normalizeMaxDepth(input.maxDepth),
      {
        ...(optionalString(input.exclude) === undefined
          ? {}
          : { excludePatterns: splitCommaList(optionalString(input.exclude)) }),
        ...(optionalString(input.importSyntax) === undefined
          ? {}
          : { importSyntax: optionalString(input.importSyntax) }),
      },
      entries,
      skips,
      visited,
    );
  }

  const clamped = clampEntriesToBudget(entries, DEFAULT_MAX_BYTES);

  return buildReadResult(
    clamped.entries,
    skips,
    clamped.exceeded,
    clamped.exceeded ? 'bytes' : undefined,
  );
}

interface SearchResponse {
  readonly results?: readonly { readonly path?: unknown }[];
}

/** Executes `read_files`. */
export async function readFiles(
  runtime: ReaderRuntime,
  input: ReadFilesInput,
): Promise<ReadResult> {
  const pattern = requireNonEmptyString(input.pattern, 'pattern');
  const patterns = splitCommaList(pattern);

  if (patterns.length === 0) {
    throw new ReadInputError('pattern', 'The field "pattern" must contain at least one pattern.');
  }

  const requestedScope = optionalString(input.scope);
  const scope = requestedScope === undefined
    ? ''
    : toWorkspacePath(requestedScope, runtime.workspaceRoot);

  if (scope !== '') {
    try {
      await runtime.fs.stat(scope);
    } catch (error: unknown) {
      if (isPathViolation(error)) {
        throw error;
      }
    }
  }

  const maxResults = asOptionalPositiveInteger(input.maxResults);
  const searchInput: Record<string, unknown> = {
    patterns,
    ...(scope === '' ? {} : { directory: scope }),
    ...(maxResults === undefined ? {} : { maxResults }),
  };

  const searchResult = await runtime.executeTool(
    'search_files',
    searchInput,
    runtime.signal === undefined ? undefined : { signal: runtime.signal },
  );

  if (searchResult.status !== 'success') {
    throw new SearchExecutionError(
      searchResult.error instanceof Error
        ? searchResult.error.message
        : typeof searchResult.error === 'string'
          ? searchResult.error
          : searchResult.message ?? 'Search failed.',
    );
  }

  const response = searchResult.data as SearchResponse | undefined;
  const results = Array.isArray(response?.results) ? response.results : [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const result of results) {
    if (typeof result.path !== 'string' || result.path.length === 0) {
      continue;
    }

    const kernelPath = toWorkspacePath(result.path, runtime.workspaceRoot);

    if (kernelPath.length === 0 || seen.has(kernelPath)) {
      continue;
    }

    seen.add(kernelPath);
    candidates.push(kernelPath);
  }

  return readCandidates(runtime, candidates, {
    isImportRead: asBoolean(input.isImportRead, false),
    maxDepth: 0,
  });
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRECTORIES.has(name);
}

async function collectDirectoryFiles(
  runtime: ReaderRuntime,
  directoryPath: string,
  recursive: boolean,
  excludePatterns: readonly string[],
): Promise<string[]> {
  const files: string[] = [];

  const walk = async (currentPath: string): Promise<void> => {
    if (runtime.signal?.aborted) {
      return;
    }

    let entries: readonly ReaderDirectoryEntry[];

    try {
      entries = await runtime.fs.readDirectory(currentPath);
    } catch (error: unknown) {
      if (isPathViolation(error)) {
        throw error;
      }

      return;
    }

    for (const entry of entries) {
      const childPath = joinWorkspacePath(currentPath, entry.name);

      if (entry.isDirectory) {
        if (
          !recursive
          || shouldSkipDirectory(entry.name)
          || isExcludedPath(childPath, excludePatterns)
        ) {
          continue;
        }

        await walk(childPath);
        continue;
      }

      if (entry.isFile) {
        files.push(childPath);
      }
    }
  };

  await walk(directoryPath);

  return files;
}

/** Executes `read_directory`. */
export async function readDirectory(
  runtime: ReaderRuntime,
  input: ReadDirectoryInput,
): Promise<ReadResult> {
  const requestedPath = requireString(input.directoryPath, 'directoryPath');
  const directoryPath = toWorkspacePath(requestedPath, runtime.workspaceRoot);
  const recursive = asBoolean(input.recursive, false);
  const excludePatterns = splitCommaList(optionalString(input.exclude));

  const candidates = await collectDirectoryFiles(
    runtime,
    directoryPath,
    recursive,
    excludePatterns,
  );

  return readCandidates(runtime, candidates, {
    isImportRead: false,
    maxDepth: 0,
    ...(excludePatterns.length === 0 ? {} : { excludePatterns }),
  });
}