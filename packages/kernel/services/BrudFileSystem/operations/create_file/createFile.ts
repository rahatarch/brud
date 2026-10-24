import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { ensureParentDirectory } from '../shared/directories.js';
import { FileAlreadyExistsError } from '../shared/errors.js';

export interface CreateFileOptions {
  readonly overwrite?: boolean;
}

export async function createFile(
  driver: IStorageDriver,
  absolutePath: string,
  data: Uint8Array | string,
  options?: CreateFileOptions,
): Promise<void> {
  await ensureParentDirectory(driver, absolutePath);

  if (options?.overwrite === false && (await driver.exists(absolutePath))) {
    throw new FileAlreadyExistsError(absolutePath);
  }

  await driver.writeFile(absolutePath, data);
}
