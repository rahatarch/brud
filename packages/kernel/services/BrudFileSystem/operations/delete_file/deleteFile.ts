import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { hasErrorCode } from '../shared/errors.js';

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
  }
}
