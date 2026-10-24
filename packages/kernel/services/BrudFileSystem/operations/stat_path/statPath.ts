import type { FileStats, IStorageDriver } from '../../../../drivers/contracts/index.js';

export async function statPath(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<FileStats | null> {
  return driver.stat(absolutePath);
}
