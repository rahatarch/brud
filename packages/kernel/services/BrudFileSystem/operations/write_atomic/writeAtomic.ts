import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { ensureParentDirectory } from '../shared/directories.js';

export const ATOMIC_TEMP_SUFFIX = '.tmp';

async function removeTemporaryFile(driver: IStorageDriver, temporaryPath: string): Promise<void> {
  try {
    await driver.deleteFile(temporaryPath);
  } catch {
    return;
  }
}

export async function writeAtomic(
  driver: IStorageDriver,
  absolutePath: string,
  data: Uint8Array | string,
): Promise<void> {
  const temporaryPath = `${absolutePath}${ATOMIC_TEMP_SUFFIX}`;

  try {
    await ensureParentDirectory(driver, absolutePath);
    await driver.writeFile(temporaryPath, data);
    await driver.rename(temporaryPath, absolutePath);
  } catch (error: unknown) {
    await removeTemporaryFile(driver, temporaryPath);
    throw error;
  }
}
