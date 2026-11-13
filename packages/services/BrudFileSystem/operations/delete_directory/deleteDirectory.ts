import { dirname } from 'node:path';
import type { IStorageDriver } from '../../contracts/index.js';
import { flushDirectory } from '../shared/durability.js';
import {
  FileSystemError,
  hasErrorCode,
  isPermissionError,
} from '../shared/errors.js';

function mapDeleteDirectoryError(error: unknown, absolutePath: string): unknown {
  if (hasErrorCode(error, 'ENOENT')) {
    return null;
  }

  if (hasErrorCode(error, 'ENOTDIR')) {
    return new FileSystemError(
      'CANNOT_DELETE_FILE_AS_DIRECTORY',
      absolutePath,
      `Cannot delete a file as a directory: "${absolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'ENOTEMPTY')) {
    return new FileSystemError(
      'CONFLICT',
      absolutePath,
      `Directory is not empty: "${absolutePath}"`,
    );
  }

  if (isPermissionError(error)) {
    return new FileSystemError(
      'EACCES',
      absolutePath,
      `Permission denied while deleting directory "${absolutePath}"`,
    );
  }

  return error;
}

export async function deleteDirectory(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<boolean> {
  const stats = await driver.stat(absolutePath);

  if (stats === null) {
    return false;
  }

  if (!stats.isDirectory) {
    throw new FileSystemError(
      'CANNOT_DELETE_FILE_AS_DIRECTORY',
      absolutePath,
      `Cannot delete a file as a directory: "${absolutePath}"`,
    );
  }

  try {
    await driver.deleteDirectory(absolutePath);
  } catch (error: unknown) {
    const mapped = mapDeleteDirectoryError(error, absolutePath);

    if (mapped === null) {
      return false;
    }

    throw mapped;
  }

  await flushDirectory(driver, dirname(absolutePath));

  return true;
}