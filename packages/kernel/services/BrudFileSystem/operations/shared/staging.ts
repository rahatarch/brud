import { basename, dirname, join } from 'node:path';
import type { DirectoryEntry, IStorageDriver } from '../../../../drivers/contracts/index.js';

/** Private staging files never end in this suffix alone. */
export const ATOMIC_TEMP_SUFFIX = '.tmp';

/**
 * Staging name pattern: `.<target>.<pid>.<uuid>.tmp`.
 *
 * The target basename is retained only for operator diagnostics. Uniqueness
 * comes from the process id and a random UUID, so two writers (including two
 * processes) can never stage into the same path.
 */
const STAGING_NAME_PATTERN = /^\.(.+)\.(\d+)\.([0-9a-fA-F-]{36})\.tmp$/u;

/** Default age after which an orphan staging file is swept. */
export const STAGING_MAX_AGE_MS = 60 * 60 * 1000;

/** Directory names the sweep never descends into. */
const SWEEP_SKIP_DIRECTORIES = new Set(['.git']);

export interface StagingPathOptions {
  /** Process id segment; defaults to the current process. */
  readonly pid?: number;

  /** UUID segment factory; defaults to `crypto.randomUUID`. */
  readonly createId?: () => string;
}

/**
 * Builds an unpredictable staging path in the target's parent directory.
 *
 * @param absolutePath - Canonical target path.
 * @param options - Process id and id generator overrides for tests.
 * @returns Sibling staging path that never equals `${target}.tmp`.
 */
export function createStagingPath(
  absolutePath: string,
  options?: StagingPathOptions,
): string {
  const pid = options?.pid ?? process.pid;
  const createId = options?.createId ?? ((): string => globalThis.crypto.randomUUID());
  const tempFileName = `.${basename(absolutePath)}.${pid}.${createId()}.tmp`;

  return join(dirname(absolutePath), tempFileName);
}

/** Parsed identity of a staging file. */
export interface StagingFileIdentity {
  readonly pid: number;

  readonly ageMs: number;
}

/**
 * Reads the owning process id from a staging filename.
 *
 * @param name - Directory entry name.
 * @param nowMs - Current time in milliseconds.
 * @param mtimeMs - Entry modification time when the driver reports one.
 * @returns Parsed identity, or `null` for a non-staging name.
 */
export function parseStagingFileName(
  name: string,
  nowMs: number,
  mtimeMs?: number,
): StagingFileIdentity | null {
  const match = STAGING_NAME_PATTERN.exec(name);

  if (match === null) {
    return null;
  }

  return {
    pid: Number.parseInt(match[2] ?? '', 10),
    ageMs: mtimeMs === undefined ? 0 : Math.max(0, nowMs - mtimeMs),
  };
}

/** Reports whether a process id is currently alive. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as { readonly code?: unknown }).code === 'EPERM';
  }
}

export interface StagingSweepOptions {
  /** Current clock injection point. */
  readonly now?: () => number;

  /** Process liveness probe injection point. */
  readonly isAlive?: (pid: number) => boolean;

  /** Removes entries whose age exceeds this value even when the pid is alive. */
  readonly maxAgeMs?: number;

  /** Receives cleanup failures instead of silently discarding them. */
  readonly onError?: (error: unknown, absolutePath: string) => void;
}

/**
 * Removes orphan staging files under a root.
 *
 * A staging file is stale when its owning process is gone or when it is older
 * than `maxAgeMs`. The sweep is idempotent, never follows symlinked
 * directories, skips `.git`, and reports every failure to `onError`.
 *
 * @param driver - Scoped storage driver.
 * @param rootAbsolutePath - Canonical directory to scan.
 * @param options - Clock, liveness, age, and error sink overrides.
 */
export async function sweepStaleStagingFiles(
  driver: IStorageDriver,
  rootAbsolutePath: string,
  options?: StagingSweepOptions,
): Promise<void> {
  const now = options?.now ?? Date.now;
  const isAlive = options?.isAlive ?? isProcessAlive;
  const maxAgeMs = options?.maxAgeMs ?? STAGING_MAX_AGE_MS;

  await sweepDirectory(driver, rootAbsolutePath, now(), isAlive, maxAgeMs, options?.onError);
}

async function sweepDirectory(
  driver: IStorageDriver,
  directoryPath: string,
  nowMs: number,
  isAlive: (pid: number) => boolean,
  maxAgeMs: number,
  onError: ((error: unknown, absolutePath: string) => void) | undefined,
): Promise<void> {
  let entries: readonly DirectoryEntry[];

  try {
    entries = await driver.readDir(directoryPath);
  } catch (error: unknown) {
    onError?.(error, directoryPath);
    return;
  }

  for (const entry of entries) {
    const absolutePath = `${directoryPath.replace(/[\\/]+$/u, '')}/${entry.name}`;

    if (entry.isDirectory) {
      if (!SWEEP_SKIP_DIRECTORIES.has(entry.name)) {
        await sweepDirectory(driver, absolutePath, nowMs, isAlive, maxAgeMs, onError);
      }
      continue;
    }

    if (!entry.isFile) {
      continue;
    }

    let mtimeMs: number | undefined;

    try {
      mtimeMs = (await driver.lstat(absolutePath))?.mtimeMs;
    } catch (error: unknown) {
      onError?.(error, absolutePath);
      continue;
    }

    const identity = parseStagingFileName(entry.name, nowMs, mtimeMs);

    if (identity === null) {
      continue;
    }

    if (identity.ageMs <= maxAgeMs && isAlive(identity.pid)) {
      continue;
    }

    try {
      await driver.deleteFile(absolutePath);
    } catch (error: unknown) {
      onError?.(error, absolutePath);
    }
  }
}
