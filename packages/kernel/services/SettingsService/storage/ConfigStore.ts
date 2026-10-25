import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
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
  SettingsLockTimeoutError,
  SettingsPathError,
  SettingsScopeError,
  getErrorCode,
} from '../contracts/errors.js';

/** Default deadline for acquiring the advisory write lock. */
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;

/** Default age after which an abandoned lock is considered stale. */
const DEFAULT_LOCK_STALE_MS = 30_000;

/** Default delay between lock acquisition attempts. */
const DEFAULT_LOCK_RETRY_MS = 10;

/** Age after which a staging file owned by a dead process is swept. */
const ORPHAN_TEMP_TTL_MS = 5_000;

/** Attempts made when a platform temporarily refuses an atomic rename. */
const RENAME_ATTEMPTS = 3;

/** Errno codes that indicate a rename may succeed on a later attempt. */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Matches `settings.json.<pid>.<timestamp>.<uuid8>.tmp` staging files. */
const ORPHAN_TEMP_PATTERN = /^settings\.json\.(\d+)\.(\d+)\.[0-9a-fA-F]{8}\.tmp$/u;

/** Metadata written into an advisory lock file. */
interface LockOwner {
  readonly pid: number;
  readonly createdAt: number;
  readonly token: string;
}

/** Result of inspecting an advisory lock file. */
interface LockInspection {
  readonly stale: boolean;
  readonly token: string | null;
}

/** Advisory lock held by the current write. */
interface HeldLock {
  readonly path: string;
  readonly token: string;
}

/** Construction options for {@link ConfigStore}. */
export interface ConfigStoreOptions {
  /** Absolute workspace root whose `.brud/settings.json` is the workspace scope. */
  readonly workspaceRoot: string;

  /** Home directory override. Defaults to `os.homedir()`. */
  readonly homeDirectory?: string;

  /** Deadline for acquiring the advisory write lock. */
  readonly lockTimeoutMs?: number;

  /** Age after which an abandoned lock is treated as stale. */
  readonly lockStaleMs?: number;

  /** Delay between lock acquisition attempts. */
  readonly lockRetryMs?: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLockOwner(raw: string): LockOwner | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainRecord(parsed)) {
    return null;
  }

  const pid = parsed.pid;
  const createdAt = parsed.createdAt;
  const token = parsed.token;

  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    return null;
  }

  return {
    pid,
    createdAt,
    // Locks written by older processes may not carry a token. The pid and
    // creation time still identify the exact lock file for a safe takeover.
    token: typeof token === 'string' ? token : `${pid}:${createdAt}`,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return getErrorCode(error) === 'EPERM';
  }
}

function assertAbsolutePath(value: string): void {
  if (value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new SettingsPathError();
  }
}

function assertScope(scope: ConfigScope): void {
  if (!isConfigScope(scope)) {
    throw new SettingsScopeError();
  }
}

/** Builds the ancestor chain of a directory, root first. */
function ancestorChain(directory: string): readonly string[] {
  const chain: string[] = [];
  let current = directory;

  for (;;) {
    chain.unshift(current);
    const parent = dirname(current);

    if (parent === current) {
      return chain;
    }

    current = parent;
  }
}

/**
 * Filesystem-backed configuration store for the two settings scopes.
 *
 * Paths are resolved exactly once at construction from immutable inputs:
 * `join(os.homedir(), '.brud', 'settings.json')` and
 * `join(workspaceRoot, '.brud', 'settings.json')`. The resolved pair is
 * frozen, and no method accepts a path, so a caller can never redirect a
 * read or write outside the configured scopes.
 *
 * Mutations follow a single atomic protocol: acquire `${target}.lock` with
 * `O_CREAT | O_EXCL`, read inside the lock, run the caller's mutator, stage to
 * a uniquely named temp file, fsync, then rename over the target. Error
 * messages are scrubbed to scope labels and errno codes.
 */
export class ConfigStore implements IConfigStore {
  private readonly targets: Readonly<Record<ConfigScope, string>>;

  private readonly lockTimeoutMs: number;

  private readonly lockStaleMs: number;

  private readonly lockRetryMs: number;

  constructor(options: ConfigStoreOptions) {
    const homeDirectory = options.homeDirectory ?? homedir();

    assertAbsolutePath(homeDirectory);
    assertAbsolutePath(options.workspaceRoot);

    this.targets = Object.freeze({
      user: join(homeDirectory, '.brud', 'settings.json'),
      workspace: join(options.workspaceRoot, '.brud', 'settings.json'),
    });
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
    this.lockRetryMs = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
  }

  getTargetPath(scope: ConfigScope): string {
    assertScope(scope);

    return this.targets[scope];
  }

  async readSnapshot(scope: ConfigScope): Promise<ConfigSnapshot> {
    assertScope(scope);
    const targetPath = this.getTargetPath(scope);

    await this.assertPathSafe(scope);

    try {
      const [content, metadata] = await Promise.all([
        readFile(targetPath, 'utf8'),
        stat(targetPath),
      ]);

      return { content, mtimeMs: metadata.mtimeMs };
    } catch (error: unknown) {
      const code = getErrorCode(error);

      if (code === 'ENOENT') {
        return { content: null, mtimeMs: 0 };
      }

      throw new SettingsIOError('read', scope, code);
    }
  }

  async transact(
    scope: ConfigScope,
    mutator: (currentContent: string | null) => Promise<string> | string,
    options?: ConfigTransactOptions,
  ): Promise<ConfigTransactionResult> {
    assertScope(scope);
    const targetPath = this.getTargetPath(scope);
    const parentDirectory = dirname(targetPath);

    await this.assertPathSafe(scope);

    try {
      await mkdir(parentDirectory, { recursive: true });
    } catch (error: unknown) {
      throw new SettingsIOError('write', scope, getErrorCode(error));
    }

    const lock = await this.acquireLock(scope, targetPath);

    try {
      const current = await this.readSnapshot(scope);

      if (
        options?.expectedMtimeMs !== undefined
        && options.expectedMtimeMs !== current.mtimeMs
      ) {
        throw new SettingsConcurrencyError(
          scope,
          options.expectedMtimeMs,
          current.mtimeMs,
        );
      }

      const nextContent = await mutator(current.content);
      const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;

      try {
        await writeAndFlush(temporaryPath, nextContent);
        await this.renameWithRetry(temporaryPath, targetPath);
      } catch (error: unknown) {
        await this.removeQuietly(temporaryPath);

        if (error instanceof SettingsIOError) {
          throw error;
        }

        throw new SettingsIOError('write', scope, getErrorCode(error));
      }

      const metadata = await stat(targetPath);

      return { writtenContent: nextContent, mtimeMs: metadata.mtimeMs };
    } finally {
      await this.releaseLock(lock);
    }
  }

  async sweepOrphanedTemps(): Promise<number> {
    const directories = new Set([
      dirname(this.targets.user),
      dirname(this.targets.workspace),
    ]);
    const now = Date.now();
    let removed = 0;

    for (const directory of directories) {
      let entries: string[];

      try {
        entries = await readdir(directory);
      } catch {
        // A missing or unreadable directory has nothing to sweep.
        continue;
      }

      for (const entry of entries) {
        const match = ORPHAN_TEMP_PATTERN.exec(entry);

        if (match === null) {
          continue;
        }

        const pid = Number(match[1]);
        const timestamp = Number(match[2]);

        if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(timestamp)) {
          continue;
        }

        if (now - timestamp <= ORPHAN_TEMP_TTL_MS) {
          continue;
        }

        if (isProcessAlive(pid)) {
          continue;
        }

        if (await this.removeQuietly(join(directory, entry))) {
          removed += 1;
        }
      }
    }

    return removed;
  }

  /**
   * Rejects resolution through a dangling or unusable path chain.
   *
   * Every existing ancestor is inspected with `lstat`. A symbolic link must
   * resolve with `realpath` to an existing directory; anything else is a
   * configuration hazard and fails closed.
   */
  private async assertPathSafe(scope: ConfigScope): Promise<void> {
    const directory = dirname(this.getTargetPath(scope));

    for (const segment of ancestorChain(directory)) {
      let metadata;

      try {
        metadata = await lstat(segment);
      } catch (error: unknown) {
        if (getErrorCode(error) === 'ENOENT') {
          // Nothing below a missing ancestor can exist yet; creation is safe.
          return;
        }

        throw new SettingsPathError(scope);
      }

      if (metadata.isSymbolicLink()) {
        try {
          const resolved = await realpath(segment);
          const resolvedMetadata = await stat(resolved);

          if (!resolvedMetadata.isDirectory()) {
            throw new SettingsPathError(scope);
          }
        } catch (error: unknown) {
          if (error instanceof SettingsPathError) {
            throw error;
          }

          throw new SettingsPathError(scope);
        }

        continue;
      }

      if (!metadata.isDirectory()) {
        throw new SettingsPathError(scope);
      }
    }
  }

  private async acquireLock(scope: ConfigScope, targetPath: string): Promise<HeldLock> {
    const lockPath = `${targetPath}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;

    for (;;) {
      const token = randomUUID();

      try {
        // `wx` maps to O_CREAT | O_EXCL | O_WRONLY: creation is atomic.
        const handle = await open(lockPath, 'wx');

        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }),
            'utf8',
          );
        } catch (error: unknown) {
          await this.removeQuietly(lockPath);
          throw error;
        } finally {
          await handle.close();
        }

        return { path: lockPath, token };
      } catch (error: unknown) {
        const code = getErrorCode(error);

        if (code !== 'EEXIST') {
          throw new SettingsIOError('write', scope, code);
        }

        const inspection = await this.inspectLock(lockPath);

        if (inspection.stale && await this.takeOverStaleLock(lockPath, inspection.token)) {
          continue;
        }

        if (Date.now() >= deadline) {
          throw new SettingsLockTimeoutError(scope, this.lockTimeoutMs);
        }

        await delay(this.lockRetryMs);
      }
    }
  }

  private async inspectLock(lockPath: string): Promise<LockInspection> {
    let raw: string;
    let mtimeMs: number;

    try {
      const [content, metadata] = await Promise.all([
        readFile(lockPath, 'utf8'),
        stat(lockPath),
      ]);
      raw = content;
      mtimeMs = metadata.mtimeMs;
    } catch (error: unknown) {
      return { stale: getErrorCode(error) === 'ENOENT', token: null };
    }

    const owner = parseLockOwner(raw);
    const token = owner?.token ?? null;
    const age = Date.now() - mtimeMs;

    if (age > this.lockStaleMs) {
      return { stale: true, token };
    }

    if (owner === null) {
      // A freshly created lock may not have been written yet. Treat it as
      // active until the TTL expires instead of racing the owner.
      return { stale: false, token: null };
    }

    if (Date.now() - owner.createdAt > this.lockStaleMs) {
      return { stale: true, token };
    }

    return { stale: !isProcessAlive(owner.pid), token };
  }

  private async takeOverStaleLock(lockPath: string, token: string | null): Promise<boolean> {
    if (token === null) {
      try {
        const metadata = await stat(lockPath);

        if (Date.now() - metadata.mtimeMs <= this.lockStaleMs) {
          return false;
        }
      } catch (error: unknown) {
        return getErrorCode(error) === 'ENOENT';
      }

      await this.removeQuietly(lockPath);
      return true;
    }

    try {
      const raw = await readFile(lockPath, 'utf8');
      const owner = parseLockOwner(raw);

      if (owner?.token !== token) {
        // A peer replaced the stale lock between inspection and takeover.
        return false;
      }
    } catch (error: unknown) {
      return getErrorCode(error) === 'ENOENT';
    }

    await this.removeQuietly(lockPath);
    return true;
  }

  private async renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
      try {
        await rename(sourcePath, targetPath);
        return;
      } catch (error: unknown) {
        lastError = error;
        const code = getErrorCode(error);

        if (code === undefined || !RETRYABLE_RENAME_CODES.has(code)) {
          throw error;
        }

        if (attempt < RENAME_ATTEMPTS - 1) {
          await delay(this.lockRetryMs);
        }
      }
    }

    throw lastError;
  }

  private async releaseLock(lock: HeldLock): Promise<void> {
    try {
      const raw = await readFile(lock.path, 'utf8');
      const owner = parseLockOwner(raw);

      if (owner?.token !== lock.token) {
        // The lock was taken over after this write exceeded the stale TTL.
        return;
      }
    } catch {
      return;
    }

    await this.removeQuietly(lock.path);
  }

  private async removeQuietly(path: string): Promise<boolean> {
    try {
      await unlink(path);
      return true;
    } catch {
      // The lock or temp file may already have been removed by a peer.
      return false;
    }
  }
}

/**
 * Writes content and forces it to stable storage before the atomic replace.
 *
 * @param path - Staging file path.
 * @param content - Complete document to persist.
 */
async function writeAndFlush(path: string, content: string): Promise<void> {
  const handle = await open(path, 'w');

  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
