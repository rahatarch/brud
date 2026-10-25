import { dirname } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { flushDirectory } from '../shared/durability.js';
import { hasErrorCode } from '../shared/errors.js';

/**
 * Deletes a file idempotently and flushes the containing directory entry when
 * the driver supports durable metadata writes.
 *
 * @param driver - Scoped storage driver.
 * @param absolutePath - Target path already validated by `WorkspaceService`.
 */
export async function deleteFile(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<void> {
  try {
    await driver.deleteFile(absolutePath);
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error;
    }

    return;
  }

  await flushDirectory(driver, dirname(absolutePath));
}
