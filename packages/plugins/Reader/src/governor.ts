/**
 * Batch governor for the Reader tools.
 *
 * The governor is deliberately pure: it owns the ratified read ceilings,
 * byte accounting, exclusion matching, and bounded execution. It performs no
 * I/O and has no kernel dependency.
 */

/** Maximum number of candidate files in one non-import read batch. */
export const MAX_FILES_PER_BATCH = 100;

/** Default aggregate byte budget for one read result. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum number of reads in flight at once. */
export const MAX_CONCURRENCY = 16;

/** Number of leading bytes inspected by the binary sniff. */
export const BINARY_SNIFF_BYTES = 8192;

/** Stable machine-readable governor failure. */
export type GovernorErrorCode = 'BATCH_LIMIT_EXCEEDED';

/** Raised when a batch exceeds the file-count ceiling. */
export class GovernorError extends Error {
  public readonly code: GovernorErrorCode = 'BATCH_LIMIT_EXCEEDED';

  public readonly requested: number;

  public readonly limit: number;

  /**
   * @param requested - Candidate files in the rejected batch.
   * @param limit - Maximum candidates allowed.
   */
  constructor(requested: number, limit: number) {
    super('Read batch too large.');
    this.name = 'GovernorError';
    this.requested = requested;
    this.limit = limit;
  }
}

/**
 * Refuses a batch whose candidate count exceeds the file ceiling.
 *
 * The count is taken before exclusion filtering, matching the legacy
 * pre-admission gate: a 101-path batch is refused even when most candidates
 * would later be excluded.
 *
 * @param candidateCount - Candidate files discovered for the batch.
 * @throws {GovernorError} When the count exceeds {@link MAX_FILES_PER_BATCH}.
 */
export function assertBatchLimit(candidateCount: number): void {
  if (candidateCount > MAX_FILES_PER_BATCH) {
    throw new GovernorError(candidateCount, MAX_FILES_PER_BATCH);
  }
}

/** Tracks aggregate bytes admitted into one read result. */
export class ByteBudget {
  private used = 0;

  /**
   * @param limitBytes - Aggregate byte ceiling.
   */
  constructor(public readonly limitBytes: number = DEFAULT_MAX_BYTES) {}

  /** Bytes admitted so far. */
  public get usedBytes(): number {
    return this.used;
  }

  /** Bytes still available. */
  public get remainingBytes(): number {
    return Math.max(0, this.limitBytes - this.used);
  }

  /**
   * Admits a size when it fits the remaining budget.
   *
   * @param size - Size in bytes.
   * @returns `true` when admitted; `false` when the item must be dropped.
   */
  public tryAdmit(size: number): boolean {
    const normalized = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;

    if (this.used + normalized > this.limitBytes) {
      return false;
    }

    this.used += normalized;

    return true;
  }
}

/** Splits a comma-separated list, preserving commas inside brace groups. */
export function splitCommaList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const character of value) {
    if (character === '{') {
      depth++;
      current += character;
    } else if (character === '}') {
      depth = Math.max(0, depth - 1);
      current += character;
    } else if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  parts.push(current);

  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function escapeCharClass(value: string): string {
  let result = '';

  for (const character of value) {
    if (character === ']' || character === '\\') {
      result += `\\${character}`;
    } else {
      result += character;
    }
  }

  return result;
}

function findMatchingBrace(pattern: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < pattern.length; index++) {
    if (pattern[index] === '{') {
      depth++;
    } else if (pattern[index] === '}') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitBraceAlternatives(inner: string): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;

  for (const character of inner) {
    if (character === '{') {
      depth++;
      current += character;
    } else if (character === '}') {
      depth = Math.max(0, depth - 1);
      current += character;
    } else if (character === ',' && depth === 0) {
      alternatives.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  alternatives.push(current);

  return alternatives;
}

function patternToRegex(pattern: string): string {
  let index = 0;
  let result = '';

  while (index < pattern.length) {
    const character = pattern[index]!;

    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        result += '.*';
        index += 3;
      } else {
        result += '.*';
        index += 2;
      }
    } else if (character === '*') {
      result += '[^/]*';
      index++;
    } else if (character === '?') {
      result += '[^/]';
      index++;
    } else if (character === '[') {
      const closeBracket = pattern.indexOf(']', index);

      if (closeBracket === -1) {
        result += '\\[';
        index++;
      } else {
        result += `[${escapeCharClass(pattern.slice(index + 1, closeBracket))}]`;
        index = closeBracket + 1;
      }
    } else if (character === '{') {
      const closing = findMatchingBrace(pattern, index);
      const alternatives = closing === -1
        ? []
        : splitBraceAlternatives(pattern.slice(index + 1, closing));

      if (closing !== -1 && alternatives.length > 1) {
        result += `(?:${alternatives.map((alternative) => patternToRegex(alternative)).join('|')})`;
        index = closing + 1;
      } else {
        result += '\\{';
        index++;
      }
    } else if ('.+^$}()|\\'.includes(character)) {
      result += `\\${character}`;
      index++;
    } else {
      result += character;
      index++;
    }
  }

  return result;
}

/** Compiles a glob pattern to an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${patternToRegex(pattern)}$`);
}

/** Reports whether text contains glob metacharacters. */
export function isGlobPattern(text: string): boolean {
  return /[*?[\]{}]/u.test(text);
}

/**
 * Reports whether a path matches any exclusion pattern.
 *
 * Glob patterns are matched against the full workspace-relative path. Plain
 * patterns keep the legacy substring behaviour, including a case-insensitive
 * basename match.
 *
 * @param filePath - Workspace-relative path.
 * @param patterns - Exclusion patterns.
 */
export function isExcludedPath(
  filePath: string,
  patterns: readonly string[] | undefined,
): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return false;
  }

  const normalized = filePath.replace(/\\/gu, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);

  return patterns.some((rawPattern) => {
    const pattern = rawPattern.trim();

    if (pattern.length === 0) {
      return false;
    }

    if (isGlobPattern(pattern)) {
      return globToRegExp(pattern).test(normalized);
    }

    return normalized.includes(pattern)
      || basename.toLowerCase().includes(pattern.toLowerCase());
  });
}

/** One bounded worker outcome. */
export interface ChunkOutcome<TValue> {
  readonly value?: TValue;
  readonly error?: unknown;
}

/**
 * Runs a worker over items in fixed-size chunks.
 *
 * Outcomes are stored by original index, so completion order never reorders
 * results. When a signal is aborted, no new chunk or item starts; items already
 * in flight finish.
 *
 * @param items - Work items.
 * @param worker - Async work function.
 * @param concurrency - Chunk size, clamped to {@link MAX_CONCURRENCY}.
 * @param signal - Optional cancellation signal.
 */
export async function mapInChunks<TItem, TValue>(
  items: readonly TItem[],
  worker: (item: TItem, index: number) => Promise<TValue>,
  concurrency: number = MAX_CONCURRENCY,
  signal?: AbortSignal,
): Promise<Array<ChunkOutcome<TValue> | undefined>> {
  const outcomes: Array<ChunkOutcome<TValue> | undefined> =
    new Array<ChunkOutcome<TValue> | undefined>(items.length).fill(undefined);

  const chunkSize = Math.max(1, Math.min(Math.floor(concurrency), MAX_CONCURRENCY));

  for (let start = 0; start < items.length; start += chunkSize) {
    if (signal?.aborted) {
      break;
    }

    const end = Math.min(start + chunkSize, items.length);
    const chunk = items.slice(start, end);

    await Promise.all(chunk.map(async (item, offset) => {
      const index = start + offset;

      if (signal?.aborted) {
        return;
      }

      try {
        outcomes[index] = { value: await worker(item, index) };
      } catch (error: unknown) {
        outcomes[index] = { error };
      }
    }));
  }

  return outcomes;
}