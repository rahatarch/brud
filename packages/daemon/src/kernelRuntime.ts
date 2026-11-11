import { join } from 'node:path';
import type * as KernelApi from '@brud/kernel' with { 'resolution-mode': 'import' };
import type {
  BrudKernel,
  IBrudPlugin,
  IStorageDriver,
} from '@brud/kernel' with { 'resolution-mode': 'import' };

type KernelModule = typeof KernelApi;

/** Default declarative composition shipped with the daemon. */
export const DEFAULT_BRUD_CONFIG_PATH = join(__dirname, '..', 'brud.config.json');

let kernelModulePromise: Promise<KernelModule> | undefined;

export function loadKernelModule(): Promise<KernelModule> {
  kernelModulePromise ??= import('@brud/kernel');
  return kernelModulePromise;
}

export interface KernelRuntimeOptions {
  readonly workspaceRoot: string;
  readonly initialPlugins?: readonly IBrudPlugin[];
  readonly certifyInitialPlugins?: boolean;
  readonly storageDriver?: IStorageDriver;
}

/**
 * Boots one kernel from the daemon config.
 *
 * `initialPlugins` is a test/host override; when omitted the config's plugins
 * are used.
 */
export async function createKernel(options: KernelRuntimeOptions): Promise<BrudKernel> {
  const kernelModule = await loadKernelModule();

  return kernelModule.bootKernel(DEFAULT_BRUD_CONFIG_PATH, {
    options: {
      // Namespaced contract field plus the legacy flat alias consumed by
      // services that have not migrated yet.
      'workspace.root': options.workspaceRoot,
      workspaceRoot: options.workspaceRoot,
      ...(options.storageDriver === undefined ? {} : { storageDriver: options.storageDriver }),
      ...(options.initialPlugins === undefined ? {} : { plugins: options.initialPlugins }),
      ...(options.certifyInitialPlugins === undefined
        ? {}
        : { certifyPlugins: options.certifyInitialPlugins }),
    },
  });
}
