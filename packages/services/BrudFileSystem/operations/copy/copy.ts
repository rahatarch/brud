import { dirname } from 'node:path';
import type { IStorageDriver } from '../../contracts/index.js';
import { flushDirectory } from '../shared/durability.js';
import {
  FileSystemError,
  hasErrorCode,
  isPermissionError,
} from '../shared/errors.js';

function mapCopyError(
  error: unknown,
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
): unknown {
  if (hasErrorCode(error, 'EEXIST')) {
    return new FileSystemError(
      'CONFLICT',
      destinationAbsolutePath,
      `Copy destination already exists: "${destinationAbsolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'ENOTDIR')) {
    return new FileSystemError(
      'PARENT_NOT_FOUND',
      destinationAbsolutePath,
      `Copy destination parent is not a directory: "${destinationAbsolutePath}"`,
    );
  }

  if (hasErrorCode(error, 'ENOENT')) {
    return new FileSystemError(
      'FILE_NOT_FOUND',
      sourceAbsolutePath,
      `Copy source does not exist: "${sourceAbsolutePath}"`,
    );
  }

  if (isPermissionError(error)) {
    return new FileSystemError(
      'EACCES',
      sourceAbsolutePath,
      `Permission denied while copying "${sourceAbsolutePath}"`,
    );
  }

  return error;
}

async function preserveMode(
  driver: IStorageDriver,
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
): Promise<void> {
  const entry = await driver.lstat(sourceAbsolutePath);

  if (entry === null || entry.isSymbolicLink) {
    return;
  }

  const stats = await driver.stat(sourceAbsolutePath);

  if (stats?.isFile !== true || stats.mode === undefined) {
    return;
  }

  const chmod = driver.chmod;

  if (typeof chmod === 'function') {
    await chmod.call(driver, destinationAbsolutePath, stats.mode & 0o777);
  }
}

export async function copy(
  driver: IStorageDriver,
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
): Promise<void> {
  if ((await driver.lstat(sourceAbsolutePath)) === null) {
    throw new FileSystemError(
      'FILE_NOT_FOUND',
      sourceAbsolutePath,
      `Copy source does not exist: "${sourceAbsolutePath}"`,
    );
  }

  if ((await driver.lstat(destinationAbsolutePath)) !== null) {
    throw new FileSystemError(
      'CONFLICT',
      destinationAbsolutePath,
      `Copy destination already exists: "${destinationAbsolutePath}"`,
    );
  }

  const parentStats = await driver.stat(dirname(destinationAbsolutePath));

  if (parentStats === null || !parentStats.isDirectory) {
    throw new FileSystemError(
      'PARENT_NOT_FOUND',
      destinationAbsolutePath,
      `Copy destination parent does not exist: "${dirname(destinationAbsolutePath)}"`,
    );
  }

  try {
    await driver.copy(sourceAbsolutePath, destinationAbsolutePath);
    await preserveMode(driver, sourceAbsolutePath, destinationAbsolutePath);
  } catch (error: unknown) {
    throw mapCopyError(error, sourceAbsolutePath, destinationAbsolutePath);
  }

  await flushDirectory(driver, dirname(destinationAbsolutePath));
}