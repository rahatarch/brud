import type * as KernelApi from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { BrudKernel, IStorageDriver } from '@brud/kernel' with { 'resolution-mode': 'import' };

type KernelModule = typeof KernelApi;

let kernelModulePromise: Promise<KernelModule> | undefined;

export function loadKernelModule(): Promise<KernelModule> {
  kernelModulePromise ??= import('@brud/kernel');
  return kernelModulePromise;
}

export interface KernelRuntimeOptions {
  readonly storageDriver?: IStorageDriver;
}

export async function createKernel(options?: KernelRuntimeOptions): Promise<BrudKernel> {
  const kernelModule = await loadKernelModule();

  if (options?.storageDriver === undefined) {
    return kernelModule.createStandardKernel();
  }

  return kernelModule.createStandardKernel({ storageDriver: options.storageDriver });
}
