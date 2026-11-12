import type { DirectoryEntry, IStorageDriver } from '@brud/kernel';

export async function readDirectory(
  driver: IStorageDriver,
  absoluteDirectoryPath: string,
): Promise<readonly DirectoryEntry[]> {
  return driver.readDir(absoluteDirectoryPath);
}
