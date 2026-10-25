import type { IStorageDriver } from '../../../../drivers/contracts/index.js';
import { FileAlreadyExistsError } from '../shared/errors.js';
import { writeAtomic } from '../write_atomic/writeAtomic.js';

export interface CreateFileOptions {
  readonly overwrite?: boolean;

  /** Pre-resolved staging path supplied by the orchestrator. */
  readonly stagingPath?: string;

  /** Permission bits for the new file; defaults to `0o644`. */
  readonly mode?: number;

  /** Invoked after staging succeeds and immediately before publication. */
  readonly beforeCommit?: () => void;
}

/**
 * Creates a file through the same staged, durably flushed path as
 * {@link writeAtomic}.
 *
 * `overwrite: false` publishes with an atomic hard link, so a second creator
 * fails deterministically with {@link FileAlreadyExistsError} even when the
 * writers are separate processes. Drivers without link support fall back to
 * an existence check plus rename.
 *
 * @param driver - Scoped storage driver.
 * @param absolutePath - Target path already validated by `WorkspaceService`.
 * @param data - UTF-8 text or raw bytes.
 * @param options - Overwrite policy, staging path, mode, and commit hook.
 */
export async function createFile(
  driver: IStorageDriver,
  absolutePath: string,
  data: Uint8Array | string,
  options?: CreateFileOptions,
): Promise<void> {
  const overwrite = options?.overwrite !== false;

  if (!overwrite && (await driver.exists(absolutePath))) {
    throw new FileAlreadyExistsError(absolutePath);
  }

  await writeAtomic(driver, absolutePath, data, {
    ...(options?.stagingPath === undefined ? {} : { stagingPath: options.stagingPath }),
    ...(options?.mode === undefined ? {} : { mode: options.mode }),
    ...(options?.beforeCommit === undefined ? {} : { beforeCommit: options.beforeCommit }),
    ...(overwrite ? {} : { exclusiveTarget: true }),
  });
}
