import { open } from 'node:fs/promises';
import { NodeStorageDriver } from '../../../drivers/node/index.js';

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
