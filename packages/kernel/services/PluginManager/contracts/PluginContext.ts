import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import { PluginPermissionError } from './errors.js';
import type {
  IPluginContext,
  IPluginLogger,
  IPluginSubscriptions,
} from './IPluginContext.js';
import { CAPABILITY_PERMISSION_REQUIREMENTS } from './permissions.js';
import type { PluginCapability, PluginPermission } from './permissions.js';
import { PluginSubscriptions } from './PluginSubscriptions.js';

/**
 * Resolves scoped capability facades for a single plugin.
 *
 * The manager supplies projected facades; the context never receives raw
 * kernel services or a broker.
 */
export interface PluginCapabilityProviders {
  /** Builds the filesystem facade scoped to the owning plugin. */
  readonly fileSystem: () => IBrudFileSystem;

  /** Builds the universal history facade scoped to the owning plugin. */
  readonly universalHistory: () => IUniversalHistoryService;
}

/** Construction options for {@link PluginContext}. */
export interface PluginContextOptions {
  /** Identifier of the owning plugin. */
  readonly pluginId: string;

  /** Absolute path of the workspace the plugin operates in. */
  readonly workspaceRoot: string;

  /** Permissions declared in the plugin manifest. */
  readonly permissions: Iterable<PluginPermission>;

  /** Plugin-scoped logger supplied by the manager. */
  readonly logger: IPluginLogger;

  /** Scoped capability providers supplied by the manager. */
  readonly capabilities: PluginCapabilityProviders;

  /** Subscription registry. Defaults to a fresh {@link PluginSubscriptions}. */
  readonly subscriptions?: IPluginSubscriptions;
}

/**
 * Reference implementation of {@link IPluginContext}.
 *
 * Capability handles are resolved lazily, memoized for the plugin lifetime, and
 * only ever returned when the manifest declared a granting permission.
 */
export class PluginContext implements IPluginContext {
  public readonly pluginId: string;

  public readonly workspaceRoot: string;

  public readonly permissions: ReadonlySet<PluginPermission>;

  public readonly subscriptions: IPluginSubscriptions;

  public readonly logger: IPluginLogger;

  private readonly capabilities: PluginCapabilityProviders;

  private fileSystem: IBrudFileSystem | undefined;

  private universalHistory: IUniversalHistoryService | undefined;

  constructor(options: PluginContextOptions) {
    this.pluginId = options.pluginId;
    this.workspaceRoot = options.workspaceRoot;
    this.permissions = new Set(options.permissions);
    this.logger = options.logger;
    this.subscriptions = options.subscriptions ?? new PluginSubscriptions();
    this.capabilities = options.capabilities;
  }

  public hasPermission(permission: PluginPermission): boolean {
    return this.permissions.has(permission);
  }

  public getFileSystem(): IBrudFileSystem {
    this.assertCapability('getFileSystem', 'fileSystem');

    this.fileSystem ??= this.capabilities.fileSystem();

    return this.fileSystem;
  }

  public getUniversalHistory(): IUniversalHistoryService {
    this.assertCapability('getUniversalHistory', 'universalHistory');

    this.universalHistory ??= this.capabilities.universalHistory();

    return this.universalHistory;
  }

  private assertCapability(operation: string, capability: PluginCapability): void {
    const required = CAPABILITY_PERMISSION_REQUIREMENTS[capability];
    const granted = required.some((permission) => this.permissions.has(permission));

    if (!granted) {
      throw new PluginPermissionError(this.pluginId, operation, required);
    }
  }
}
