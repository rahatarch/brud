import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type * as KernelApi from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { IStorageDriver } from '@brud/service-filesystem' with { 'resolution-mode': 'import' };
import type { IBrudPlugin } from '@brud/service-plugin-manager' with { 'resolution-mode': 'import' };

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
 * Resolves the operator-owned identity registry file for one workspace.
 *
 * The file deliberately sits beside the workspace, not inside it. A host may
 * override the location with `BRUD_IDENTITY_REGISTRY_PATH`.
 */
export function resolveIdentityRegistryPath(workspaceRoot: string): string {
  const override = process.env.BRUD_IDENTITY_REGISTRY_PATH;

  if (typeof override === 'string' && override.length > 0) {
    return override;
  }

  return join(
    dirname(workspaceRoot),
    '.brud-identity',
    `${basename(workspaceRoot)}.json`,
  );
}

/**
 * Resolves the protected exposed API scope record for one workspace.
 *
 * The file sits beside the workspace, not inside it. A host may override the
 * location with `BRUD_EXPOSED_API_SCOPE_RECORD_PATH`.
 */
export function resolveExposedApiScopeRecordPath(workspaceRoot: string): string {
  const override = process.env.BRUD_EXPOSED_API_SCOPE_RECORD_PATH;

  if (typeof override === 'string' && override.length > 0) {
    return override;
  }

  return join(
    dirname(workspaceRoot),
    '.brud-exposed-api',
    `${basename(workspaceRoot)}.json`,
  );
}

/**
 * Builds the namespaced context bag for one workspace.
 *
 * Each migrated service reads its own field. No legacy flat alias is emitted.
 */
export function createWorkspaceContextOptions(
  workspaceRoot: string,
): Record<string, unknown> {
  return {
    'workspace.root': workspaceRoot,
    'settings.root': workspaceRoot,
    'filesystem.root': workspaceRoot,
    'terminal.root': workspaceRoot,
    'pluginManager.root': workspaceRoot,
    'history.root': workspaceRoot,
    'router.root': workspaceRoot,
    'identity.registry.path': resolveIdentityRegistryPath(workspaceRoot),
    'exposedApi.scopeRecord.path': resolveExposedApiScopeRecordPath(workspaceRoot),
  };
}

function ensureIdentityRegistry(kernelModule: KernelModule, registryPath: string): void {
  mkdirSync(dirname(registryPath), { recursive: true });

  if (!existsSync(registryPath)) {
    kernelModule.provisionIdentityRegistryStorage(registryPath);
  }
}

/**
 * Boots one kernel from the daemon config.
 *
 * `initialPlugins` is a test/host override; when omitted the config's plugins
 * are used.
 */
export async function createKernel(options: KernelRuntimeOptions): Promise<BrudKernel> {
  const kernelModule = await loadKernelModule();
  const workspaceOptions = createWorkspaceContextOptions(options.workspaceRoot);
  const registryPath = workspaceOptions['identity.registry.path'];

  if (typeof registryPath === 'string') {
    ensureIdentityRegistry(kernelModule, registryPath);
  }

  return kernelModule.bootKernel(DEFAULT_BRUD_CONFIG_PATH, {
    options: {
      ...workspaceOptions,
      'pluginManager.configPath': DEFAULT_BRUD_CONFIG_PATH,
      ...(options.storageDriver === undefined ? {} : { storageDriver: options.storageDriver }),
      ...(options.initialPlugins === undefined
        ? {}
        : { 'pluginManager.plugins': { entries: options.initialPlugins } }),
      ...(options.certifyInitialPlugins === undefined
        ? {}
        : { 'pluginManager.certifyPlugins': options.certifyInitialPlugins }),
    },
  });
}
