/**
 * Output envelopes for the Reader tools.
 *
 * These types and builders reproduce the legacy read envelope:
 * {@link ReadFileEntry}, {@link ReadSkipEntry}, and {@link ReadResult}.
 * Paths are workspace-relative in the kernel-native model.
 */

/** One delivered file. */
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

/** Why a candidate was not delivered as readable text. */
export type ReadSkipReason = 'binary' | 'unreadable' | 'excluded';

/** One skipped candidate. */
export interface ReadSkipEntry {
  path: string;
  reason: ReadSkipReason;
  error?: string;
}

/** Which governor limit cut the result. */
export type ReadLimitHit = 'files' | 'bytes';

/** Aggregated result of one read operation. */
export interface ReadResult {
  files: ReadFileEntry[];
  totalFiles: number;
  totalSize: number;
  skips?: ReadSkipEntry[];
  truncated?: boolean;
  limitHit?: ReadLimitHit;
}

/** Options accepted by the entry builders. */
export interface ReadEntryOptions {
  readonly startLine?: number;
  readonly endLine?: number;
  readonly isImported?: boolean;
  readonly importedFrom?: string;
}

/** Raised when a requested line range cannot be satisfied. */
export class LineRangeError extends Error {
  public readonly code = 'INVALID_LINE_RANGE' as const;

  public readonly startLine?: number;

  public readonly endLine?: number;

  public readonly totalLines: number;

  constructor(startLine: number | undefined, endLine: number | undefined, totalLines: number) {
    super(
      `Requested line range ${startLine ?? '?'}-${endLine ?? '?'} is invalid for file with ${totalLines} lines (1-indexed).`,
    );
    this.name = 'LineRangeError';
    this.startLine = startLine;
    this.endLine = endLine;
    this.totalLines = totalLines;
  }
}

/** Normalized 1-indexed line range. */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
}

/**
 * Counts lines the way the legacy read engine does.
 *
 * A trailing newline does not start a new line, and an empty file has zero
 * lines.
 *
 * @param content - File text.
 */
export function countTotalLines(content: string): number {
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;

  return trimmed.length === 0 ? 0 : (trimmed.match(/\n/gu) ?? []).length + 1;
}

/**
 * Validates and clamps a 1-indexed line range.
 *
 * @param startLine - Requested start; `undefined` means `1`.
 * @param endLine - Requested end; `undefined` means end-of-file.
 * @param totalLines - Total line count.
 * @throws {LineRangeError} When the start is outside the file or past the
 * clamped end.
 */
export function computeLineRange(
  startLine: number | undefined,
  endLine: number | undefined,
  totalLines: number,
): LineRange {
  const start = startLine ?? 1;
  const end = endLine ?? totalLines;

  if (start < 1 || start > totalLines) {
    throw new LineRangeError(startLine, endLine, totalLines);
  }

  const clampedEnd = Math.min(end, totalLines);

  if (start > clampedEnd) {
    throw new LineRangeError(startLine, endLine, totalLines);
  }

  return { startLine: start, endLine: clampedEnd, totalLines };
}

/** Slices text by a validated range, preserving a trailing newline. */
export function sliceLineRange(content: string, range: LineRange): string {
  const lines = content.split('\n');
  const sliced = lines.slice(range.startLine - 1, range.endLine).join('\n');

  return content.endsWith('\n') ? `${sliced}\n` : sliced;
}

/**
 * Builds a text entry, applying an optional line slice.
 *
 * Imported entries are never sliced: only the root entry of an import read
 * receives the requested range.
 *
 * @param filePath - Workspace-relative path.
 * @param content - Full decoded file text.
 * @param options - Range and import provenance.
 */
export function buildTextEntry(
  filePath: string,
  content: string,
  options: ReadEntryOptions = {},
): ReadFileEntry {
  const totalLines = countTotalLines(content);
  const hasRange = options.startLine !== undefined || options.endLine !== undefined;

  const provenance = {
    ...(options.isImported === true ? { isImported: true } : {}),
    ...(options.importedFrom === undefined ? {} : { importedFrom: options.importedFrom }),
  };

  if (hasRange) {
    const range = computeLineRange(options.startLine, options.endLine, totalLines);
    const sliced = sliceLineRange(content, range);

    return {
      path: filePath,
      content: sliced,
      size: Buffer.byteLength(sliced, 'utf8'),
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: range.totalLines,
      ...provenance,
    };
  }

  return {
    path: filePath,
    content,
    size: Buffer.byteLength(content, 'utf8'),
    startLine: 1,
    endLine: totalLines,
    totalLines,
    ...provenance,
  };
}

/** Builds a binary entry with zeroed line fields and no content. */
export function buildBinaryEntry(
  filePath: string,
  size: number,
  options: ReadEntryOptions = {},
): ReadFileEntry {
  return {
    path: filePath,
    size,
    startLine: 0,
    endLine: 0,
    totalLines: 0,
    ...(options.isImported === true ? { isImported: true } : {}),
    ...(options.importedFrom === undefined ? {} : { importedFrom: options.importedFrom }),
    isBinary: true,
  };
}

/** Builds one skip entry. */
export function buildSkipEntry(
  filePath: string,
  reason: ReadSkipReason,
  error?: string,
): ReadSkipEntry {
  return {
    path: filePath,
    reason,
    ...(error === undefined ? {} : { error }),
  };
}

/** Fits entries into an aggregate byte budget in input order. */
export function clampEntriesToBudget(
  entries: readonly ReadFileEntry[],
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

/** Assembles the aggregated result envelope. */
export function buildReadResult(
  files: ReadFileEntry[],
  skips: ReadSkipEntry[],
  truncated: boolean,
  limitHit: ReadLimitHit | undefined,
): ReadResult {
  return {
    files,
    totalFiles: files.length,
    totalSize: files.reduce((total, entry) => total + entry.size, 0),
    skips,
    truncated,
    limitHit,
  };
}

/** Builds the human-readable summary used by the operation message. */
export function summarizeReadResult(result: ReadResult): string {
  const skipped = result.skips?.length ?? 0;
  const limit = result.limitHit === undefined ? '' : `, limit=${result.limitHit}`;

  return `Read summary: delivered=${result.totalFiles} file(s), bytes=${result.totalSize}, skipped=${skipped}, truncated=${result.truncated === true ? 'yes' : 'no'}${limit}`;
}