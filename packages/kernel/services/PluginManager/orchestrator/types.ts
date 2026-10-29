import type { IBrudToolsService } from '../../BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import { PluginError, PluginDependencyError } from '../contracts/errors.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginContext } from '../contracts/IPluginContext.js';
import type { PluginState } from '../contracts/IPluginManager.js';
import type { PluginManifest } from '../contracts/manifest.js';

export interface PluginManagerRuntimeDependencies {
  readonly workspaceRoot: string;

  readonly fileSystem: () => IBrudFileSystem;

  readonly universalHistory?: () => IUniversalHistoryService;

  readonly brudTools?: () => IBrudToolsService;
}

export interface InternalPluginRecord {
  readonly plugin: IBrudPlugin;

  readonly manifest: PluginManifest;

  readonly official: boolean;

  state: PluginState;

  activatedAt?: string;

  error?: string;
}

export interface ActivePluginContextRecord {
  readonly pluginId: string;

  readonly context: IPluginContext;

  readonly activatedAt: string;
}

export class PluginManifestValidationError extends PluginError {
  public readonly code = 'PLUGIN_MANIFEST' as const;

  public readonly pluginId: string | undefined;

  public readonly reason: string;

  constructor(reason: string, pluginId?: string) {
    super(
      `Invalid plugin manifest${pluginId === undefined ? '' : ` for "${pluginId}"`}: ${reason}`,
    );
    this.name = 'PluginManifestValidationError';
    this.pluginId = pluginId;
    this.reason = reason;
  }
}

export class PluginActiveDependencyError extends PluginDependencyError {
  public readonly dependentPluginIds: readonly string[];

  constructor(pluginId: string, dependentPluginIds: readonly string[]) {
    super({ pluginId, dependencyId: dependentPluginIds[0] ?? pluginId });
    this.name = 'PluginActiveDependencyError';
    this.dependentPluginIds = [...dependentPluginIds];
    this.message = `Plugin "${pluginId}" cannot be deactivated while active dependents rely on it: ${this.dependentPluginIds.join(', ')}`;
  }
}
