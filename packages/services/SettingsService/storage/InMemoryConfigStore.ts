import type {
  ConfigSnapshot,
  ConfigTransactionResult,
  ConfigTransactOptions,
  IConfigStore,
} from '../contracts/IConfigStore.js';
import {
  isConfigScope,
  type ConfigScope,
} from '../contracts/ISettingsService.js';
import {
  SettingsConcurrencyError,
  SettingsIOError,
  SettingsScopeError,
} from '../contracts/errors.js';

/** Construction options for {@link InMemoryConfigStore}. */
export interface InMemoryConfigStoreOptions {
  /** Initial raw user-scope document. */
  readonly userContent?: string | null;

  /** Initial raw workspace-scope document. */
  readonly workspaceContent?: string | null;

  /** Errno code that every read of the scope should throw. */
  readonly readErrorCodes?: Partial<Record<ConfigScope, string>>;

  /** Errno code that every write of the scope should throw. */
  readonly writeErrorCodes?: Partial<Record<ConfigScope, string>>;
}

const TARGET_PATHS: Readonly<Record<ConfigScope, string>> = Object.freeze({
  user: '/home/brud/.brud/settings.json',
  workspace: '/workspace/.brud/settings.json',
});

function assertScope(scope: ConfigScope): void {
  if (!isConfigScope(scope)) {
    throw new SettingsScopeError();
  }
}

/**
 * Deterministic in-memory implementation of {@link IConfigStore}.
 *
 * Intended for kernel unit tests. Documents live in a map keyed by scope,
 * each with a synthetic monotonic mtime, and read/write faults can be injected
 * without touching the host filesystem.
 */
export class InMemoryConfigStore implements IConfigStore {
  private readonly contents: Record<ConfigScope, string | null>;

  private readonly mtimes: Record<ConfigScope, number>;

  private readonly readErrors: Partial<Record<ConfigScope, string>>;

  private readonly writeErrors: Partial<Record<ConfigScope, string>>;

  constructor(options?: InMemoryConfigStoreOptions) {
    const userContent = options?.userContent ?? null;
    const workspaceContent = options?.workspaceContent ?? null;

    this.contents = { user: userContent, workspace: workspaceContent };
    this.mtimes = {
      user: userContent === null ? 0 : 1,
      workspace: workspaceContent === null ? 0 : 1,
    };
    this.readErrors = { ...(options?.readErrorCodes ?? {}) };
    this.writeErrors = { ...(options?.writeErrorCodes ?? {}) };
  }

  async readSnapshot(scope: ConfigScope): Promise<ConfigSnapshot> {
    assertScope(scope);
    const code = this.readErrors[scope];

    if (code !== undefined) {
      throw new SettingsIOError('read', scope, code);
    }

    return { content: this.contents[scope], mtimeMs: this.mtimes[scope] };
  }

  async transact(
    scope: ConfigScope,
    mutator: (currentContent: string | null) => Promise<string> | string,
    options?: ConfigTransactOptions,
  ): Promise<ConfigTransactionResult> {
    assertScope(scope);

    const readError = this.readErrors[scope];

    if (readError !== undefined) {
      throw new SettingsIOError('read', scope, readError);
    }

    const writeError = this.writeErrors[scope];

    if (writeError !== undefined) {
      throw new SettingsIOError('write', scope, writeError);
    }

    const current = this.contents[scope];
    const currentMtime = this.mtimes[scope];

    if (
      options?.expectedMtimeMs !== undefined
      && options.expectedMtimeMs !== currentMtime
    ) {
      throw new SettingsConcurrencyError(scope, options.expectedMtimeMs, currentMtime);
    }

    const nextContent = await mutator(current);

    this.contents[scope] = nextContent;
    this.mtimes[scope] = currentMtime + 1;

    return { writtenContent: nextContent, mtimeMs: this.mtimes[scope] };
  }

  async sweepOrphanedTemps(): Promise<number> {
    return 0;
  }

  getTargetPath(scope: ConfigScope): string {
    assertScope(scope);

    return TARGET_PATHS[scope];
  }

  /** Replaces the raw document for a scope. */
  setRaw(scope: ConfigScope, content: string | null): void {
    assertScope(scope);
    this.contents[scope] = content;
    this.mtimes[scope] = content === null ? 0 : this.mtimes[scope] + 1;
  }

  /** Returns the current raw document for a scope. */
  getRaw(scope: ConfigScope): string | null {
    assertScope(scope);

    return this.contents[scope];
  }

  /** Returns the synthetic mtime for a scope. */
  getMtimeMs(scope: ConfigScope): number {
    assertScope(scope);

    return this.mtimes[scope];
  }

  /** Injects or clears a read failure for a scope. */
  setReadError(scope: ConfigScope, code: string | null): void {
    assertScope(scope);

    if (code === null) {
      delete this.readErrors[scope];
      return;
    }

    this.readErrors[scope] = code;
  }

  /** Injects or clears a write failure for a scope. */
  setWriteError(scope: ConfigScope, code: string | null): void {
    assertScope(scope);

    if (code === null) {
      delete this.writeErrors[scope];
      return;
    }

    this.writeErrors[scope] = code;
  }
}
