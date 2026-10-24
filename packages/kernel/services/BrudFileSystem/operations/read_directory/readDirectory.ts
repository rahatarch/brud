import type { DirectoryEntry, IStorageDriver } from '../../../../drivers/contracts/index.js';

export async function readDirectory(
  driver: IStorageDriver,
  absoluteDirectoryPath: string,
): Promise<readonly DirectoryEntry[]> {
  return driver.readDir(absoluteDirectoryPath);
}
