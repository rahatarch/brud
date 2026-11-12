import type { ConfigScope } from './ISettingsService.js';

/** Snapshot of one scope document exactly as it exists on disk. */
export interface ConfigSnapshot {
  /** Raw document, or `null` when the file does not exist. */
  readonly content: string | null;

  /** Modification time in milliseconds; `0` when the file does not exist. */
  readonly mtimeMs: number;
}

/** Result of a committed {@link IConfigStore.transact} call. */
export interface ConfigTransactionResult {
  /** Content that was written to the scope document. */
  readonly writtenContent: string;

  /** Modification time of the document after the atomic replace. */
  readonly mtimeMs: number;
}

/** Options accepted by {@link IConfigStore.transact}. */
export interface ConfigTransactOptions {
  /**
   * mtime the caller believes is current. When it differs from disk, the
   * transaction is refused with `SettingsConcurrencyError`.
   */
  readonly expectedMtimeMs?: number;
}

/**
 * Scope-gated storage port for settings documents.
 *
 * Implementations resolve exactly two immutable target paths at construction
 * time (`~/.brud/settings.json` and `<workspace>/.brud/settings.json`). The
 * interface deliberately accepts no path parameter: callers can only address
 * a scope, never an arbitrary file.
 *
 * Every mutation runs inside {@link transact}, which holds the advisory write
 * lock for the entire read-modify-write cycle. Callers therefore never need to
 * (and never can) orchestrate a read and a write separately.
 */
export interface IConfigStore {
  /**
   * Atomically reads, mutates, and replaces one scope document under the
   * advisory lock.
   *
   * @param scope - Scope to mutate.
   * @param mutator - Receives the current disk content (`null` when missing)
   * and returns the complete next document.
   * @param options - Optional optimistic concurrency expectation.
   * @returns The written content and the resulting mtime.
   */
  transact(
    scope: ConfigScope,
    mutator: (currentContent: string | null) => Promise<string> | string,
    options?: ConfigTransactOptions,
  ): Promise<ConfigTransactionResult>;

  /** Reads the raw document and its mtime without taking the write lock. */
  readSnapshot(scope: ConfigScope): Promise<ConfigSnapshot>;

  /** Returns the absolute canonical target path for diagnostic purposes only. */
  getTargetPath(scope: ConfigScope): string;

  /**
   * Removes staging files abandoned by dead processes.
   *
   * @returns The number of temporary files that were unlinked.
   */
  sweepOrphanedTemps(): Promise<number>;
}
