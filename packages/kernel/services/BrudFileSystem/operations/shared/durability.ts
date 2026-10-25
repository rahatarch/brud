import type { IStorageDriver } from '../../../../drivers/contracts/index.js';

/**
 * Optional durability capability a scoped storage driver may expose.
 *
 * Physical drivers that can flush a file or directory handle implement these
 * methods. The filesystem service calls them after staging and after renames
 * so a mutation is only reported complete once the bytes and the directory
 * entry are durable. Drivers that cannot flush (such as the in-memory driver)
 * simply omit the capability and the staging contract remains atomic.
 */
export interface IDurableStorageDriver extends IStorageDriver {
  /** Flushes a file handle and its data to stable storage. */
  readonly syncFile?: (absolutePath: string) => Promise<void>;

  /** Flushes a directory entry (rename/unlink/create) to stable storage. */
  readonly syncDirectory?: (absoluteDirectoryPath: string) => Promise<void>;
}

/** Flushes a staged file when the driver supports durable writes. */
export async function flushFile(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<void> {
  const syncFile = (driver as IDurableStorageDriver).syncFile;

  if (typeof syncFile === 'function') {
    await syncFile.call(driver, absolutePath);
  }
}

/** Flushes a directory after a rename, unlink, or directory creation. */
export async function flushDirectory(
  driver: IStorageDriver,
  absoluteDirectoryPath: string,
): Promise<void> {
  const syncDirectory = (driver as IDurableStorageDriver).syncDirectory;

  if (typeof syncDirectory === 'function') {
    await syncDirectory.call(driver, absoluteDirectoryPath);
  }
}
