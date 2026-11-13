import { open } from 'node:fs/promises';
import { NodeStorageDriver } from './NodeStorageDriver.js';

function isUnsupportedDirectorySync(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;

  return code === 'EISDIR'
    || code === 'EPERM'
    || code === 'EACCES'
    || code === 'EINVAL'
    || code === 'ENOTSUP'
    || code === 'ENOENT';
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * Node storage driver with durable flush capabilities.
 *
 * The filesystem service stays Node-free; this adapter is selected by the
 * standard bootstrap as the host's scoped driver. Staged writes are flushed
 * with `fsync` before the rename, and the containing directory is flushed
 * after the rename, unlink, or directory creation so a completed mutation is
 * also a durable one.
 *
 * Directory handles cannot be opened on every platform. Unsupported sync
 * errors are treated as best-effort; file flushes always propagate.
 */
export class DurableNodeStorageDriver extends NodeStorageDriver {
  protected async renameNative(sourcePath: string, targetPath: string): Promise<void> {
    await super.rename(sourcePath, targetPath);
  }

  override async rename(sourcePath: string, targetPath: string): Promise<void> {
    try {
      await this.renameNative(sourcePath, targetPath);
      return;
    } catch (error: unknown) {
      if (!isErrno(error, 'EXDEV')) {
        throw error;
      }
    }

    process.emitWarning(
      `brud.core.filesystem: cross-device rename from "${sourcePath}" to "${targetPath}" `
      + 'fell back to copy + delete',
      'BrudFilesystemWarning',
    );

    await this.copy(sourcePath, targetPath);

    const stats = await this.stat(sourcePath);

    if (stats?.isDirectory === true) {
      await this.deleteDirectory(sourcePath);
      return;
    }

    await this.deleteFile(sourcePath);
  }

  /**
   * Creates a staging file with POSIX exclusive-create semantics.
   *
   * `O_CREAT | O_EXCL | O_WRONLY` is inherited from the Node driver so a
   * pre-planted file or symlink at the staging path fails with `EEXIST`
   * instead of being followed or overwritten.
   */
  override async writeFileExclusive(
    absolutePath: string,
    data: Uint8Array | string,
    options?: { readonly mode?: number },
  ): Promise<void> {
    await super.writeFileExclusive(absolutePath, data, options);
  }

  async syncFile(absolutePath: string): Promise<void> {
    const handle = await open(absolutePath, 'r+');

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async syncDirectory(absoluteDirectoryPath: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(absoluteDirectoryPath, 'r');
      await handle.sync();
    } catch (error: unknown) {
      if (!isUnsupportedDirectorySync(error)) {
        throw error;
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
