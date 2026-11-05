/**
 * Pure mutation governor.
 *
 * It owns the ratified mutation ceilings, byte accounting, and bounded
 * execution. It performs no I/O and has no kernel dependency, so every limit
 * can be tested in isolation and checked before a session is opened.
 */
import { depthOf } from '../paths.js';

/** Maximum number of files one mutation may touch. */
export const MAX_FILES_PER_MUTATION = 100;

/** Maximum path depth accepted by a mutation target. */
export const MAX_DIRECTORY_DEPTH = 32;

/** Maximum aggregate bytes one mutation may write or append. */
export const MAX_BYTES_PER_MUTATION = 16 * 1024 * 1024;

/** Maximum number of per-file operations in flight. */
export const MAX_CONCURRENCY = 8;

export type GovernorCode =
  | 'BATCH_LIMIT_EXCEEDED'
  | 'DEPTH_LIMIT_EXCEEDED'
  | 'BYTE_LIMIT_EXCEEDED';

export interface GovernorDecision {
  readonly ok: boolean;
  readonly code?: GovernorCode;
  readonly message?: string;
  readonly limit?: number;
  readonly requested?: number;
}

function pass(): GovernorDecision {
  return { ok: true };
}

function fail(
  code: GovernorCode,
  limit: number,
  requested: number,
  message: string,
): GovernorDecision {
  return { ok: false, code, limit, requested, message };
}

/** Refuses a batch whose candidate count exceeds the file ceiling. */
export function checkBatch(files: readonly string[]): GovernorDecision {
  if (files.length > MAX_FILES_PER_MUTATION) {
    return fail(
      'BATCH_LIMIT_EXCEEDED',
      MAX_FILES_PER_MUTATION,
      files.length,
      `Mutation batch too large: ${files.length} files (limit ${MAX_FILES_PER_MUTATION}).`,
    );
  }

  return pass();
}

/** Refuses a target deeper than {@link MAX_DIRECTORY_DEPTH}. */
export function checkDepth(path: string): GovernorDecision {
  const depth = depthOf(path);

  if (depth > MAX_DIRECTORY_DEPTH) {
    return fail(
      'DEPTH_LIMIT_EXCEEDED',
      MAX_DIRECTORY_DEPTH,
      depth,
      `Path depth too large: ${depth} segments (limit ${MAX_DIRECTORY_DEPTH}).`,
    );
  }

  return pass();
}

/** Refuses an aggregate byte total above {@link MAX_BYTES_PER_MUTATION}. */
export function checkBytes(totalBytes: number): GovernorDecision {
  const normalized = Number.isFinite(totalBytes) && totalBytes > 0
    ? Math.floor(totalBytes)
    : 0;

  if (normalized > MAX_BYTES_PER_MUTATION) {
    return fail(
      'BYTE_LIMIT_EXCEEDED',
      MAX_BYTES_PER_MUTATION,
      normalized,
      `Mutation byte budget exceeded: ${normalized} bytes (limit ${MAX_BYTES_PER_MUTATION}).`,
    );
  }

  return pass();
}

/**
 * Runs a worker over items with at most `limit` invocations in flight.
 *
 * Completion order never reorders results: each outcome is stored at its
 * original index. The effective limit is clamped to {@link MAX_CONCURRENCY}.
 */
export async function runWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  fn: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit), MAX_CONCURRENCY));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await fn(items[index]!, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, () => worker()),
  );

  return results;
}