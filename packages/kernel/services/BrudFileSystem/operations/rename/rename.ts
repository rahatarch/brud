import { dirname } from 'node:path';
import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { flushDirectory } from '../shared/durability.js';
import {
  FileSystemError,
  hasErrorCode,
  isPermissionError,
} from '../shared/errors.js';

function mapRenameError(
  error: unknown,
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
): unknown {
  if (hasErrorCode(error, 'ENOENT')) {
    return new FileSystemError(
      'FILE_NOT_FOUND',
      sourceAbsolutePath,
      `Rename source does not exist: "${sourceAbsolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'EEXIST') || hasErrorCode(error, 'ENOTEMPTY') || hasErrorCode(error, 'EISDIR')) {
    return new FileSystemError(
      'CONFLICT',
      destinationAbsolutePath,
      `Rename destination already exists: "${destinationAbsolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'ENOTDIR')) {
    return new FileSystemError(
      'PARENT_NOT_FOUND',
      destinationAbsolutePath,
      `Rename destination parent is not a directory: "${destinationAbsolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'EXDEV')) {
    return new FileSystemError(
      'UNSUPPORTED',
      sourceAbsolutePath,
      `Cross-device rename is not supported by this storage driver: "${sourceAbsolutePath}"`,
    );
  }

  if (isPermissionError(error)) {
    return new FileSystemError(
      'EACCES',
      sourceAbsolutePath,
      `Permission denied while renaming "${sourceAbsolutePath}"`,
    );
  }

  return error;
}

export async function rename(
  driver: IStorageDriver,
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
): Promise<void> {
  if ((await driver.lstat(sourceAbsolutePath)) === null) {
    throw new FileSystemError(
      'FILE_NOT_FOUND',
      sourceAbsolutePath,
      `Rename source does not exist: "${sourceAbsolutePath}"`,
    );
  }

  if ((await driver.lstat(destinationAbsolutePath)) !== null) {
    throw new FileSystemError(
      'CONFLICT',
      destinationAbsolutePath,
      `Rename destination already exists: "${destinationAbsolutePath}"`,
    );
  }

  const parentStats = await driver.stat(dirname(destinationAbsolutePath));

  if (parentStats === null || !parentStats.isDirectory) {
    throw new FileSystemError(
      'PARENT_NOT_FOUND',
      destinationAbsolutePath,
      `Rename destination parent does not exist: "${dirname(destinationAbsolutePath)}"`,
    );
  }

  try {
    await driver.rename(sourceAbsolutePath, destinationAbsolutePath);
  } catch (error: unknown) {
    throw mapRenameError(error, sourceAbsolutePath, destinationAbsolutePath);
  }

  await flushDirectory(driver, dirname(destinationAbsolutePath));

  if (dirname(sourceAbsolutePath) !== dirname(destinationAbsolutePath)) {
    await flushDirectory(driver, dirname(sourceAbsolutePath));
  }
}