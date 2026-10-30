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
): Promise<void> {
  if (sha256Hex(bytes) !== digest) {
    throw new UnifiedBlobIntegrityError(digest, sha256Hex(bytes));
  }

  const target = blobPath(historyRoot, digest);
  const directory = resolve(target, '..');

  if (await driver.exists(target)) {
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
