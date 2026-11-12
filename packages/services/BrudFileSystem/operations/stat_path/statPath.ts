import type { FileStats, IStorageDriver } from '@brud/kernel';

export async function statPath(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<FileStats | null> {
  return driver.stat(absolutePath);
}
