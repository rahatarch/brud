import path from 'path';
import { FileSystem } from '../types/filesystem.js';
import { readFileWithImports } from '../import-resolver/index.js';
import { searchFiles } from '../search/fileSearch.js';
import type { FileSearchQuery } from '../search/types.js';
import { BrudAPI, BrudError } from '../api/index.js';
import type { BrudSettings } from '../settings/types.js';
import {
  BINARY_SAMPLE_BYTES,
  DEFAULT_READ_CONCURRENCY,
  DEFAULT_SETTINGS,
  HARD_MAX_AGGREGATE_BYTES,
  MAX_BATCH_FILES,
  MAX_READ_CONCURRENCY,
} from '../settings/types.js';
import type { PathCache } from '../utils/workspacePath.js';

export interface ReadFileEntry {
  path: string;
  content?: string;
  size: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  isImported?: boolean;
  importedFrom?: string;
  isBinary?: boolean;
}

export type ReadSkipReason = 'binary' | 'unreadable' | 'excluded';

export interface ReadSkipEntry {
  path: string;
  reason: ReadSkipReason;
  error?: string;
}

export type ReadLimitHit = 'files' | 'bytes';

export interface ReadResult {
  files: ReadFileEntry[];
  totalFiles: number;
  totalSize: number;
  skips?: ReadSkipEntry[];
  truncated?: boolean;
  limitHit?: ReadLimitHit;
}

export interface ReadFilesOptions {
  settings?: BrudSettings;
  pathCache?: PathCache;
  signal?: AbortSignal;
}

interface ItemOutcome {
  entries: ReadFileEntry[];
  skips: ReadSkipEntry[];
}

interface PoolOutcome<T> {
  value?: T;
  error?: unknown;
}

function calculateTotalLines(content: string): number {
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.length === 0 ? 0 : (trimmed.match(/\n/g) || []).length + 1;
}

function sliceContent(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  const slicedLines = lines.slice(startLine - 1, endLine);
  return slicedLines.join('\n') + (content.endsWith('\n') ? '\n' : '');
}

function buildEntry(
  filePath: string,
  content: string,
  startLine?: number,
  endLine?: number,
  isImported?: boolean,
  importedFrom?: string,
): ReadFileEntry {
  const totalLines = calculateTotalLines(content);

  if (startLine !== undefined || endLine !== undefined) {
    const vr = BrudAPI.validate.lineRange(startLine, endLine, totalLines);
    if (!vr.success) {
      throw new BrudError({
        code: vr.code!,
        friendly: vr.friendly!,
        details: vr.details!,
        path: filePath,
      });
    }
    const range = vr.data as { startLine: number; endLine: number; totalLines: number };
    const sliced = sliceContent(content, range.startLine, range.endLine);
    return {
      path: filePath,
      content: sliced,
      size: Buffer.byteLength(sliced, 'utf8'),
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: range.totalLines,
      isImported,
      importedFrom,
    };
  }

  return {
    path: filePath,
    content,
    size: Buffer.byteLength(content, 'utf8'),
    startLine: 1,
    endLine: totalLines,
    totalLines,
    isImported,
    importedFrom,
  };
}

function buildBinaryEntry(
  filePath: string,
  size: number,
  isImported?: boolean,
  importedFrom?: string,
): ReadFileEntry {
  return {
    path: filePath,
    size,
    startLine: 0,
    endLine: 0,
    totalLines: 0,
    isImported,
    importedFrom,
    isBinary: true,
  };
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.length, BINARY_SAMPLE_BYTES);
  for (let i = 0; i < sampleLength; i++) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}

function isBinaryContent(content: string): boolean {
  return content.slice(0, BINARY_SAMPLE_BYTES).indexOf('\0') !== -1;
}

function resolveBatchLimit(settings: BrudSettings | undefined): number {
  const configured = settings?.readMaxBatchFiles;
  const fallback = DEFAULT_SETTINGS.readMaxBatchFiles ?? MAX_BATCH_FILES;
  const candidate = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : fallback;
  return Math.min(candidate, MAX_BATCH_FILES);
}

function resolveAggregateByteLimit(settings: BrudSettings | undefined): number {
  const configured = settings?.readMaxAggregateBytes;
  const fallback = DEFAULT_SETTINGS.readMaxAggregateBytes ?? HARD_MAX_AGGREGATE_BYTES;
  const candidate = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : fallback;
  return Math.min(candidate, HARD_MAX_AGGREGATE_BYTES);
}

function resolveConcurrency(settings: BrudSettings | undefined): number {
  const configured = settings?.readConcurrency;
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return DEFAULT_READ_CONCURRENCY;
  }
  return Math.min(MAX_READ_CONCURRENCY, Math.max(1, Math.floor(configured)));
}

function isExcluded(filePath: string, excludePatterns: string[] | undefined): boolean {
  if (!excludePatterns) {
    return false;
  }
  return excludePatterns.some(pattern => filePath.includes(pattern));
}

async function runBoundedPool<T>(
  items: string[],
  limit: number,
  signal: AbortSignal | undefined,
  worker: (item: string, index: number) => Promise<T>,
): Promise<Array<PoolOutcome<T> | undefined>> {
  const outcomes: Array<PoolOutcome<T> | undefined> = new Array(items.length);
  if (items.length === 0) {
    return outcomes;
  }

  const laneCount = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const lanes = Array.from({ length: laneCount }, async () => {
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      try {
        outcomes[currentIndex] = { value: await worker(items[currentIndex], currentIndex) };
      } catch (error) {
        outcomes[currentIndex] = { error };
      }
    }
  });

  await Promise.all(lanes);
  return outcomes;
}

function clampEntriesToBudget(
  entries: ReadFileEntry[],
  maxAggregateBytes: number,
): { entries: ReadFileEntry[]; totalSize: number; exceeded: boolean } {
  const kept: ReadFileEntry[] = [];
  let totalSize = 0;
  let exceeded = false;

  for (const entry of entries) {
    if (totalSize + entry.size > maxAggregateBytes) {
      exceeded = true;
      break;
    }
    totalSize += entry.size;
    kept.push(entry);
  }

  return { entries: kept, totalSize, exceeded };
}

async function readImportEntries(
  fs: FileSystem,
  filePath: string,
  maxDepth: number,
  excludePatterns: string[] | undefined,
  importSyntax: string[] | undefined,
  startLine: number | undefined,
  endLine: number | undefined,
): Promise<ItemOutcome> {
  const entries: ReadFileEntry[] = [];
  const skips: ReadSkipEntry[] = [];
  const effectiveDepth = maxDepth === 0 ? Infinity : maxDepth;
  const { files: fileMap, errors } = await readFileWithImports(
    fs,
    filePath,
    effectiveDepth,
    excludePatterns,
    importSyntax,
  );

  let isFirst = true;
  for (const [p, content] of fileMap) {
    if (isBinaryContent(content)) {
      entries.push(buildBinaryEntry(
        p,
        Buffer.byteLength(content, 'utf8'),
        isFirst ? undefined : true,
        isFirst ? undefined : filePath,
      ));
      skips.push({ path: p, reason: 'binary' });
    } else {
      entries.push(isFirst
        ? buildEntry(p, content, startLine, endLine)
        : buildEntry(p, content, undefined, undefined, true, filePath));
    }
    isFirst = false;
  }

  for (const readError of errors) {
    skips.push({ path: readError.filePath, reason: 'unreadable', error: readError.error });
  }

  return { entries, skips };
}

async function readDirectEntry(
  fs: FileSystem,
  filePath: string,
  startLine: number | undefined,
  endLine: number | undefined,
): Promise<ItemOutcome> {
  const entries: ReadFileEntry[] = [];
  const skips: ReadSkipEntry[] = [];

  try {
    if (typeof fs.readFileBytes === 'function') {
      const bytes = await fs.readFileBytes(filePath);
      if (isBinaryBytes(bytes)) {
        entries.push(buildBinaryEntry(filePath, bytes.byteLength));
        skips.push({ path: filePath, reason: 'binary' });
        return { entries, skips };
      }
      const content = Buffer.from(bytes).toString('utf8');
      entries.push(buildEntry(filePath, content, startLine, endLine));
      return { entries, skips };
    }

    const content = await fs.readFile(filePath);
    if (isBinaryContent(content)) {
      entries.push(buildBinaryEntry(filePath, Buffer.byteLength(content, 'utf8')));
      skips.push({ path: filePath, reason: 'binary' });
      return { entries, skips };
    }
    entries.push(buildEntry(filePath, content, startLine, endLine));
    return { entries, skips };
  } catch (err) {
    if (err instanceof BrudError) {
      throw err;
    }
    skips.push({
      path: filePath,
      reason: 'unreadable',
      error: err instanceof Error ? err.message : String(err),
    });
    return { entries, skips };
  }
}

export async function readFiles(
  fs: FileSystem,
  filePaths: string[],
  isImportRead: boolean,
  maxDepth: number,
  excludePatterns?: string[],
  importSyntax?: string[],
  startLine?: number,
  endLine?: number,
  options?: ReadFilesOptions,
): Promise<ReadResult> {
  const maxBatchFiles = resolveBatchLimit(options?.settings);
  const maxAggregateBytes = resolveAggregateByteLimit(options?.settings);
  const concurrency = resolveConcurrency(options?.settings);

  if (!isImportRead && filePaths.length > maxBatchFiles) {
    throw BrudAPI.errors.batchLimitExceededError(filePaths.length, maxBatchFiles);
  }

  const skips: ReadSkipEntry[] = [];
  const candidates: string[] = [];

  for (const filePath of filePaths) {
    if (isExcluded(filePath, excludePatterns)) {
      skips.push({ path: filePath, reason: 'excluded' });
      continue;
    }
    candidates.push(filePath);
  }

  let admitted = candidates;
  let truncated = false;
  let limitHit: ReadLimitHit | undefined;

  if (typeof fs.stat === 'function') {
    admitted = [];
    let admittedBytes = 0;
    for (const filePath of candidates) {
      let fileSize: number;
      try {
        fileSize = (await fs.stat(filePath)).size;
      } catch {
        admitted.push(filePath);
        continue;
      }
      if (admittedBytes + fileSize > maxAggregateBytes) {
        truncated = true;
        limitHit = 'bytes';
        break;
      }
      admittedBytes += fileSize;
      admitted.push(filePath);
    }
  }

  const outcomes = await runBoundedPool(admitted, concurrency, options?.signal, (filePath) => (
    isImportRead
      ? readImportEntries(fs, filePath, maxDepth, excludePatterns, importSyntax, startLine, endLine)
      : readDirectEntry(fs, filePath, startLine, endLine)
  ));

  for (const outcome of outcomes) {
    if (outcome?.error instanceof BrudError) {
      throw outcome.error;
    }
  }

  const entries: ReadFileEntry[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    if (!outcome) {
      continue;
    }
    if (outcome.value) {
      entries.push(...outcome.value.entries);
      skips.push(...outcome.value.skips);
      continue;
    }
    skips.push({
      path: admitted[i],
      reason: 'unreadable',
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
  }

  const clamped = clampEntriesToBudget(entries, maxAggregateBytes);
  if (clamped.exceeded) {
    truncated = true;
    limitHit = 'bytes';
  }

  return {
    files: clamped.entries,
    totalFiles: clamped.entries.length,
    totalSize: clamped.totalSize,
    skips,
    truncated,
    limitHit,
  };
}

export async function readDirectoryFiles(
  fs: FileSystem,
  directoryPath: string,
  recursive: boolean,
  excludePatterns?: string[],
  maxResults?: number,
): Promise<string[]> {
  const query: FileSearchQuery = {
    patterns: ['**'],
    excludePatterns,
    directory: directoryPath,
    recursive,
    maxResults: maxResults ?? Infinity,
  };

  const response = await searchFiles(fs, query);
  return response.results.map(r => path.resolve(directoryPath, r.path));
}
