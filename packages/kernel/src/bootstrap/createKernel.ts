import type { IStorageDriver } from '../../drivers/contracts/index.js';
import { createFileSystemDescriptor } from '../../services/BrudFileSystem/descriptor/descriptor.js';
import { BrudKernel } from '../engine/BrudKernel.js';

/**
 * Options accepted by {@link createStandardKernel}.
 */
export interface CreateStandardKernelOptions {
  /** Storage backend backing the file system service. Defaults to the node driver. */
  readonly storageDriver?: IStorageDriver;
}

/**
 * Builds an unbooted kernel with the standard core services registered.
 *
 * The returned kernel accepts additional service registrations before
 * {@link BrudKernel.boot} is called.
 *
 * @param options - Optional driver overrides for testing or alternate backends.
 * @returns A kernel instance ready to boot.
 */
export function createStandardKernel(options?: CreateStandardKernelOptions): BrudKernel {
  const kernel = new BrudKernel();
  kernel.register(createFileSystemDescriptor({ driver: options?.storageDriver }));
  return kernel;
}
