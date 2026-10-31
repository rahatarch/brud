/**
 * Content-addressed blob tree for the unified history store (U2-D1, U2-D2).
 *
 * Layout: `<historyRoot>/cas/<first-2-hex>/<sha256>`. Every path is derived
 * only from a validated lowercase 64-hex digest, so writes cannot leave the
 * `cas/` tree. All IO goes through the injected `IStorageDriver`; this module
 * does not import `node:fs`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import {
  UnifiedBlobIntegrityError,
  UnifiedBlobMissingError,
  UnifiedInvalidDigestError,
} from './errors.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export const CAS_DIRECTORY = 'cas';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertDigest(digest: string): void {
  if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
    throw new UnifiedInvalidDigestError(String(digest));
  }
}

/** Relative reference stored in `contents.blob_ref`. */
export function blobRef(digest: string): string {
  assertDigest(digest);
  return `${CAS_DIRECTORY}/${digest.slice(0, 2)}/${digest}`;
}

/** Absolute path of a blob, guaranteed to lie inside `<historyRoot>/cas/`. */
export function blobPath(historyRoot: string, digest: string): string {
  assertDigest(digest);
  const casRoot = resolve(historyRoot, CAS_DIRECTORY);
  const target = resolve(casRoot, digest.slice(0, 2), digest);
  if (!target.startsWith(casRoot + sep)) {
    throw new UnifiedInvalidDigestError(digest);
  }
  return target;
}

interface DurableDriver extends IStorageDriver {
  readonly syncFile?: (path: string) => Promise<void>;
  readonly syncDirectory?: (path: string) => Promise<void>;
}

async function flushFile(driver: IStorageDriver, path: string): Promise<void> {
  const sync = (driver as DurableDriver).syncFile;
  if (typeof sync === 'function') {
    await sync.call(driver, path);
  }
}

async function flushDirectory(driver: IStorageDriver, path: string): Promise<void> {
  const sync = (driver as DurableDriver).syncDirectory;
  if (typeof sync === 'function') {
    await sync.call(driver, path);
  }
}

/**
 * Reads a blob and verifies it against its address.
 *
 * @throws UnifiedBlobMissingError when the file does not exist.
 * @throws UnifiedBlobIntegrityError when the bytes do not hash to `digest`.
 */
export async function readBlob(driver: IStorageDriver, historyRoot: string, digest: string): Promise<Uint8Array> {
  const path = blobPath(historyRoot, digest);
  if (!(await driver.exists(path))) {
    throw new UnifiedBlobMissingError(digest);
  }
  const bytes = await driver.readFile(path);
  const actual = sha256Hex(bytes);
  if (actual !== digest) {
    throw new UnifiedBlobIntegrityError(digest, actual);
  }
  return bytes;
}

/**
 * Writes a blob durably: exclusive temp file, flush, rename, flush directory.
 * An existing valid blob is reused; an existing corrupt blob is replaced.
 */
export async function writeBlob(
  driver: IStorageDriver,
  historyRoot: string,
  digest: string,
  bytes: Uint8Array,
  options: { readonly fresh?: boolean } = {},
): Promise<void> {
  if (sha256Hex(bytes) !== digest) {
    throw new UnifiedBlobIntegrityError(digest, sha256Hex(bytes));
  }

  const target = blobPath(historyRoot, digest);
  const directory = resolve(target, '..');

  // `fresh` always replaces through temp + rename, giving the file a new mtime,
  // so the orphan sweep's age check cannot claim a blob that is being stored
  // again after its row was garbage-collected (D-15 U-8).
  if (options.fresh !== true && await driver.exists(target)) {
    try {
      await readBlob(driver, historyRoot, digest);
      return;
    } catch (error) {
      if (!(error instanceof UnifiedBlobIntegrityError)) {
        throw error;
      }
    }
  }

  await driver.mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${digest}.${process.pid}.${randomUUID()}.tmp`);

  try {
    if (typeof driver.writeFileExclusive === 'function') {
      await driver.writeFileExclusive(temporary, bytes);
    } else {
      await driver.writeFile(temporary, bytes);
    }
    await flushFile(driver, temporary);
    await driver.rename(temporary, target);
    await flushDirectory(driver, directory);
  } catch (error) {
    try {
      if (await driver.exists(temporary)) {
        await driver.deleteFile(temporary);
      }
    } catch {
      // The temp file is reclaimable; the original error is what matters.
    }
    throw error;
  }
}

/** Result of {@link sweepCas}. */
export interface CasSweepReport {
  readonly blobsRemoved: number;
  readonly stagingRemoved: number;
  /** `true` when the per-run budget stopped the sweep early. */
  readonly truncated: boolean;
}

/** Options for {@link sweepCas}. */
export interface CasSweepOptions {
  /** Whether a `contents` row still references the digest (checked twice). */
  readonly isReferenced: (digest: string) => boolean;
  /** Current time in epoch milliseconds. */
  readonly now: number;
  /** Files younger than this are never removed. */
  readonly graceMs: number;
  /** Most files removed in one run. */
  readonly maxRemovals: number;
}

const SHARD_PATTERN = /^[0-9a-f]{2}$/u;
const STAGING_PATTERN = /^\.[0-9a-f]{64}\..+\.tmp$/u;

/**
 * Removes blob files no `contents` row references and abandoned staging files,
 * both only when older than the grace period (D-15 U-8).
 *
 * Only `<historyRoot>/cas/<aa>/` is visited; legacy `blobs/` and every other
 * path are never touched. A blob must be named by a valid digest inside its
 * own shard, and its reference is re-checked immediately before deletion.
 */
export async function sweepCas(
  driver: IStorageDriver,
  historyRoot: string,
  options: CasSweepOptions,
): Promise<CasSweepReport> {
  const root = join(resolve(historyRoot), CAS_DIRECTORY);
  let blobsRemoved = 0;
  let stagingRemoved = 0;

  if (!(await driver.exists(root))) {
    return { blobsRemoved, stagingRemoved, truncated: false };
  }

  const isOld = async (path: string): Promise<boolean> => {
    const stats = await driver.stat(path);
    return stats !== null && stats.isFile && options.now - stats.mtimeMs > options.graceMs;
  };

  for (const shard of await driver.readDir(root)) {
    if (!shard.isDirectory || !SHARD_PATTERN.test(shard.name)) {
      continue;
    }
    const directory = join(root, shard.name);

    for (const entry of await driver.readDir(directory)) {
      if (blobsRemoved + stagingRemoved >= options.maxRemovals) {
        return { blobsRemoved, stagingRemoved, truncated: true };
      }
      if (!entry.isFile) {
        continue;
      }
      const path = join(directory, entry.name);

      if (STAGING_PATTERN.test(entry.name)) {
        if (await isOld(path)) {
          await driver.deleteFile(path);
          stagingRemoved += 1;
        }
        continue;
      }

      if (!SHA256_PATTERN.test(entry.name) || entry.name.slice(0, 2) !== shard.name) {
        continue;
      }
      if (options.isReferenced(entry.name) || !(await isOld(path)) || options.isReferenced(entry.name)) {
        continue;
      }
      await driver.deleteFile(path);
      blobsRemoved += 1;
    }
  }

  return { blobsRemoved, stagingRemoved, truncated: false };
}
