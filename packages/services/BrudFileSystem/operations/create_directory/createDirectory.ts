import { dirname } from 'node:path';
import type { IStorageDriver } from '../../contracts/index.js';
import { flushDirectory } from '../shared/durability.js';
import {
  FileSystemError,
  hasErrorCode,
  isPermissionError,
} from '../shared/errors.js';

function mapCreateDirectoryError(error: unknown, absolutePath: string): unknown {
  if (hasErrorCode(error, 'EEXIST') || hasErrorCode(error, 'ENOTDIR')) {
    return new FileSystemError(
      'CONFLICT',
      absolutePath,
      `Cannot create directory because a non-directory entry exists: "${absolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'ENOENT')) {
    return new FileSystemError(
      'PARENT_NOT_FOUND',
      absolutePath,
      `Parent directory does not exist: "${absolutePath}"`,
    );
  }

  if (isPermissionError(error)) {
    return new FileSystemError(
      'EACCES',
      absolutePath,
      `Permission denied while creating directory "${absolutePath}"`,
    );
  }

  return error;
}

export async function createDirectory(
  driver: IStorageDriver,
  absolutePath: string,
): Promise<boolean> {
  const existing = await driver.stat(absolutePath);

  if (existing !== null) {
    if (!existing.isDirectory) {
      throw new FileSystemError(
        'CONFLICT',
        absolutePath,
        `A non-directory entry already exists at "${absolutePath}"`,
      );
    }

    return false;
  }

  try {
    await driver.createDirectory(absolutePath);
  } catch (error: unknown) {
    throw mapCreateDirectoryError(error, absolutePath);
  }

  await flushDirectory(driver, dirname(absolutePath));

  return true;
}