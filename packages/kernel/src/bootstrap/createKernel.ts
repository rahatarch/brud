import { realpathSync } from 'node:fs';
import type { IStorageDriver } from '../../drivers/contracts/index.js';
import { createFileSystemDescriptor } from '../../services/BrudFileSystem/descriptor/descriptor.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { createPluginManagerDescriptor } from '../../services/PluginManager/descriptor/index.js';
import {
  createSettingsDescriptor,
  createSettingsReaderDescriptor,
  type SettingsDescriptorOptions,
} from '../../services/SettingsService/descriptor/descriptor.js';
import {
  createUniversalHistoryDescriptor,
  type UniversalHistoryDescriptorOptions,
} from '../../services/UniversalHistory/descriptor/index.js';
import {
  createWorkspaceDescriptor,
  type WorkspaceDescriptorOptions,
} from '../../services/WorkspaceService/descriptor/descriptor.js';
import type { KernelBootOptions } from '../contracts/kernel.js';
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
  /**
   * Settings store, defaults, or warning sink overrides. Defaults to the
   * filesystem-backed `~/.brud/settings.json` and
   * `<workspace>/.brud/settings.json` scopes.
   */
  readonly settings?: SettingsDescriptorOptions;
  /**
   * Workspace root registry, path flavor, and warning sink overrides.
   *
   * Defaults to a single root taken from `kernel.boot({ workspaceRoot })`
   * and the canonical `realpath` of that root resolved at boot.
   */
  readonly workspace?: WorkspaceDescriptorOptions;
  /**
   * Plugins registered into the plugin manager before the kernel boots.
   *
   * Registration is passive. The plugins are activated during the boot
   * sequence, after the filesystem and history services have initialized.
   */
  readonly initialPlugins?: readonly IBrudPlugin[];
}

/**
 * Canonicalizes the boot workspace root before any service is constructed.
 *
 * `WorkspaceService.primaryRoot` and the `BrudFileSystem` `PathValidator` root
 * must be the same string, otherwise a workspace reached through a symbolic
 * link yields two different notions of "inside". The boot root is therefore
 * resolved once here and handed to every descriptor through
 * `ServiceContext.workspaceRoot` instead of letting each service canonicalize
 * its own copy.
 *
 * Roots that only exist inside a virtual driver (an in-memory root such as
 * `/workspace`) do not resolve on the host and keep their declared form; the
 * workspace service still canonicalizes them through its own port.
 *
 * @param workspaceRoot - Declared boot workspace root.
 * @returns The host-canonical root when it exists, otherwise the declared root.
 */
function canonicalizeBootRoot(workspaceRoot: string): string {
  try {
    return realpathSync(workspaceRoot);
  } catch {
    return workspaceRoot;
  }
}

/**
 * Builds an unbooted kernel with the standard core services registered.
 *
 * The returned kernel accepts additional service registrations before
 * {@link BrudKernel.boot} is called.
 *
 * Boot order is structural: settings, settings reader, workspace, filesystem,
 * history, then plugins. Workspace precedes the filesystem service so the
 * canonical root identity exists before any content service initializes.
 *
 * @param options - Optional driver, workspace, history, and plugin overrides for testing or alternate backends.
 * @returns A kernel instance ready to boot.
 */
export function createStandardKernel(options?: CreateStandardKernelOptions): BrudKernel {
  const kernel = new BrudKernel();
  kernel.register(createSettingsDescriptor(options?.settings));
  kernel.register(createSettingsReaderDescriptor());
  kernel.register(createWorkspaceDescriptor({
    driver: options?.storageDriver,
    ...options?.workspace,
  }));
  kernel.register(createFileSystemDescriptor({ driver: options?.storageDriver }));
  kernel.register(createUniversalHistoryDescriptor(options?.history));
  kernel.register(createPluginManagerDescriptor({
    initialPlugins: options?.initialPlugins,
    withUniversalHistory: true,
  }));

  const boot = kernel.boot.bind(kernel);
  kernel.boot = async (bootOptions: KernelBootOptions): Promise<void> =>
    boot({
      ...bootOptions,
      workspaceRoot: canonicalizeBootRoot(bootOptions.workspaceRoot),
    });

  return kernel;
}
