import type { IStorageDriver } from '../../drivers/contracts/index.js';
import { createFileSystemDescriptor } from '../../services/BrudFileSystem/descriptor/descriptor.js';
import {
  createUniversalHistoryDescriptor,
  type UniversalHistoryDescriptorOptions,
} from '../../services/UniversalHistory/descriptor/index.js';
import { BrudKernel } from '../engine/BrudKernel.js';

/**
 * Options accepted by {@link createStandardKernel}.
 */
export interface CreateStandardKernelOptions {
  /** Storage backend backing the file system service. Defaults to the node driver. */
  readonly storageDriver?: IStorageDriver;
  /**
   * History ledger overrides. Defaults to `.brud/history/ledger.db` inside
   * the boot workspace.
   */
  readonly history?: UniversalHistoryDescriptorOptions;
}

/**
 * Builds an unbooted kernel with the standard core services registered.
 *
 * The returned kernel accepts additional service registrations before
 * {@link BrudKernel.boot} is called.
 *
 * @param options - Optional driver and history overrides for testing or alternate backends.
 * @returns A kernel instance ready to boot.
 */
export function createStandardKernel(options?: CreateStandardKernelOptions): BrudKernel {
  const kernel = new BrudKernel();
  kernel.register(createFileSystemDescriptor({ driver: options?.storageDriver }));
  kernel.register(createUniversalHistoryDescriptor(options?.history));
  return kernel;
}
