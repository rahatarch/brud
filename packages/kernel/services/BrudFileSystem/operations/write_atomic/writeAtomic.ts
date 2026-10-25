import { dirname } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { ensureParentDirectory } from '../shared/directories.js';
import { flushDirectory, flushFile } from '../shared/durability.js';
import {
  CommittedWithDurabilityWarningError,
  FileAlreadyExistsError,
  FileSystemError,
  hasErrorCode,
} from '../shared/errors.js';
import { ATOMIC_TEMP_SUFFIX, createStagingPath } from '../shared/staging.js';

export { ATOMIC_TEMP_SUFFIX };

export interface WriteAtomicOptions {
  /**
   * Pre-resolved staging path.
   *
   * `BrudFileSystem` resolves the generated staging path through
   * `WorkspaceService.resolveContained` and passes the canonical result here
   * so the driver never sees an unvalidated path.
   */
  readonly stagingPath?: string;

  /** Permission bits to apply to the staging file before publication. */
  readonly mode?: number;

  /**
   * Publishes with an atomic hard link instead of `rename`.
   *
   * Used by `createFile({ overwrite: false })`: the link fails with `EEXIST`
   * when any entry (including a symlink) already exists at the target, so only
   * the first creator wins across processes.
   */
  readonly exclusiveTarget?: boolean;

  /**
   * Called after the staged file is flushed and all pre-commit checks passed,
   * immediately before the atomic publication. Journaling hooks use this so
   * no `before` record is published for an operation that failed to stage.
   */
  readonly beforeCommit?: () => void;
}

async function removeTemporaryFile(driver: IStorageDriver, temporaryPath: string): Promise<void> {
  try {
    await driver.deleteFile(temporaryPath);
  } catch {
    return;
  }
}

async function chmodIfSupported(
  driver: IStorageDriver,
  absolutePath: string,
  mode: number,
): Promise<void> {
  const chmod = driver.chmod;

  if (typeof chmod === 'function') {
    await chmod.call(driver, absolutePath, mode);
  }
}

async function createStagingFile(
  driver: IStorageDriver,
  stagingPath: string,
  data: Uint8Array | string,
  mode: number,
): Promise<void> {
  const writeFileExclusive = driver.writeFileExclusive;

  if (typeof writeFileExclusive === 'function') {
    try {
      await writeFileExclusive.call(driver, stagingPath, data, { mode });
      return;
    } catch (error: unknown) {
      if (hasErrorCode(error, 'EEXIST')) {
        throw new FileSystemError(
          'STAGING_CONFLICT',
          stagingPath,
          `Staging path already exists: "${stagingPath}"`,
        );
      }

      throw error;
    }
  }

  if (await driver.exists(stagingPath)) {
    throw new FileSystemError(
      'STAGING_CONFLICT',
      stagingPath,
      `Staging path already exists: "${stagingPath}"`,
    );
  }

  await driver.writeFile(stagingPath, data);
}

async function publish(
  driver: IStorageDriver,
  stagingPath: string,
  absolutePath: string,
  exclusiveTarget: boolean,
): Promise<void> {
  if (!exclusiveTarget) {
    await driver.rename(stagingPath, absolutePath);
    return;
  }

  const link = driver.link;

  if (typeof link !== 'function') {
    if (await driver.exists(absolutePath)) {
      throw new FileAlreadyExistsError(absolutePath);
    }

    await driver.rename(stagingPath, absolutePath);
    return;
  }

  try {
    await link.call(driver, stagingPath, absolutePath);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new FileAlreadyExistsError(absolutePath);
    }

    throw error;
  }
}

/**
 * Writes through a decisive, uniquely named staging file and publishes it
 * atomically.
 *
 * The staging path is never `${target}.tmp`; it is
 * `.<target>.<pid>.<uuid>.tmp` in the same directory. Creation uses an
 * exclusive open (`O_CREAT | O_EXCL | O_WRONLY`) so a pre-planted file or
 * symlink at the staging path fails closed instead of being followed.
 *
 * The staged handle is flushed before publication. A directory flush failure
 * after the rename/link is reported as
 * {@link CommittedWithDurabilityWarningError} so callers never mistake a
 * committed mutation for a failed one.
 *
 * @param driver - Scoped storage driver.
 * @param absolutePath - Target path already validated by `WorkspaceService`.
 * @param data - UTF-8 text or raw bytes.
 * @param options - Staging path, mode, exclusive target, and commit hook.
 */
export async function writeAtomic(
  driver: IStorageDriver,
  absolutePath: string,
  data: Uint8Array | string,
  options?: WriteAtomicOptions,
): Promise<void> {
  const stagingPath = options?.stagingPath ?? createStagingPath(absolutePath);
  const mode = options?.mode ?? 0o644;
  const exclusiveTarget = options?.exclusiveTarget === true;
  let staged = true;

  try {
    await ensureParentDirectory(driver, absolutePath);
    await createStagingFile(driver, stagingPath, data, mode);
    await flushFile(driver, stagingPath);

    if (options?.mode !== undefined) {
      await chmodIfSupported(driver, stagingPath, options.mode);
    }

    if (exclusiveTarget && (await driver.exists(absolutePath))) {
      throw new FileAlreadyExistsError(absolutePath);
    }

    options?.beforeCommit?.();

    await publish(driver, stagingPath, absolutePath, exclusiveTarget);
    staged = false;

    if (exclusiveTarget) {
      await removeTemporaryFile(driver, stagingPath);
    }

    try {
      await flushDirectory(driver, dirname(absolutePath));
    } catch (error: unknown) {
      throw new CommittedWithDurabilityWarningError(absolutePath, error);
    }
  } catch (error: unknown) {
    if (staged) {
      await removeTemporaryFile(driver, stagingPath);
    }

    throw error;
  }
}
