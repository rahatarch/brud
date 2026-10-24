import type { IStorageDriver } from '../../drivers/contracts/index.js';

/**
 * Configuration for a standard kernel composition.
 */
export interface StandardKernelOptions {
  /** Absolute path of the workspace the kernel operates in. */
  readonly workspaceRoot: string;

  /** Storage backend backing the file system service. Defaults to the node driver. */
  readonly storageDriver?: IStorageDriver;
}
