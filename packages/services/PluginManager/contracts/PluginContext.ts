import type {
  ActionRegistrationOptions,
  IActionManager,
} from '../../ActionManager/contracts/index.js';
import type {
  IBrudToolsReader,
  IBrudToolsService,
  IPluginExecutionContext,
  ListToolsFilter,
  RegisteredToolInfo,
  ToolRegistrationOptions,
} from '../../BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IPluginHistoryService, IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import { isPluginHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import type { IUtilityService } from '../../UtilityService/contracts/IUtilityService.js';
import type { OperationResult } from '@brud/kernel';
import { PluginPermissionError } from './errors.js';
import type {
  IPluginContext,
  IPluginDisposable,
  IPluginLogger,
  IPluginSubscriptions,
} from './IPluginContext.js';
import type { ITerminalHandle } from './ITerminalHandle.js';
import type { ITerminalService } from '../../TerminalService/contracts/ITerminalService.js';
import { CORE_API_NAME } from '../../ExposedApiRegistry/contracts/coreApis.js';
import { CAPABILITY_PERMISSION_REQUIREMENTS } from './permissions.js';
import type { PluginCapability, PluginPermission } from './permissions.js';
import { PluginSubscriptions } from './PluginSubscriptions.js';
import { createTerminalHandle } from './TerminalHandle.js';

/**
 * Resolves scoped capability facades for a single plugin.
 *
 * The manager supplies a Registry-backed resolver; the context never receives
 * raw kernel services or a broker.
 */
export interface PluginCapabilityProviders {
  /**
   * Resolves any registered API name through the Exposed API Registry.
   *
   * Returns `null` when no registration matches the plugin's capabilities.
   */
  readonly resolveApi: (apiName: string) => unknown | null;
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

  /**
   * Official certification status derived by the kernel from the plugin brand.
   *
   * Defaults to `false`, so a plugin cannot claim certification by
   * constructing its own context.
   */
  readonly official?: boolean;

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

  private readonly official: boolean;

  private readonly capabilities: PluginCapabilityProviders;

  private fileSystem: IBrudFileSystem | undefined;

  private universalHistory: IPluginHistoryService | undefined;

  private history: NamespaceHistoryHandle | undefined;

  private brudToolsReader: IBrudToolsReader | undefined;

  private actionManager: IActionManager | undefined;

  private utilities: IUtilityService | undefined;

  private terminalHandle: ITerminalHandle | null | undefined;

  private readonly resolvedApis = new Map<string, unknown>();

  constructor(options: PluginContextOptions) {
    this.pluginId = options.pluginId;
    this.workspaceRoot = options.workspaceRoot;
    this.permissions = new Set(options.permissions);
    this.logger = options.logger;
    this.subscriptions = options.subscriptions ?? new PluginSubscriptions();
    this.official = options.official ?? false;
    this.capabilities = options.capabilities;
  }

  public hasPermission(permission: PluginPermission): boolean {
    return this.permissions.has(permission);
  }

  public resolve<T = unknown>(apiName: string): T | null {
    return this.resolveApi(apiName) as T | null;
  }

  public getFileSystem(): IBrudFileSystem {
    this.assertCapability('getFileSystem', 'fileSystem');

    this.fileSystem ??= this.requireApi<IBrudFileSystem>(
      CORE_API_NAME.fileSystem,
      'Filesystem',
    );

    return this.fileSystem;
  }

  public getUniversalHistory(): IPluginHistoryService {
    this.assertCapability('getUniversalHistory', 'universalHistory');

    if (!this.official) {
      throw new PluginPermissionError(
        this.pluginId,
        'getUniversalHistory',
        CAPABILITY_PERMISSION_REQUIREMENTS.universalHistory,
        'the core session history is reserved for official plugins; use getHistory()',
      );
    }

    if (this.universalHistory === undefined) {
      const history = this.requireApi<IUniversalHistoryService>(
        CORE_API_NAME.universalHistory,
        'Universal history',
      );

      if (!isPluginHistoryService(history)) {
        throw new Error(
          `UniversalHistory provider for plugin "${this.pluginId}" does not implement the plugin history contract`,
        );
      }

      this.universalHistory = history;
    }

    return this.universalHistory;
  }

  public getHistory(): NamespaceHistoryHandle {
    this.assertCapability('getHistory', 'universalHistory');

    if (this.history === undefined) {
      const inner = this.requireApi<NamespaceHistoryHandle>(
        CORE_API_NAME.namespaceHistory,
        'Namespace history',
      );
      // Entry types live as long as the plugin: their disposables join the
      // plugin's subscriptions, so deactivation unregisters reversal handlers.
      this.history = Object.freeze({
        ...inner,
        registerEntryType: (registration: Parameters<NamespaceHistoryHandle['registerEntryType']>[0]) => {
          const disposable = inner.registerEntryType(registration);
          this.subscriptions.add(disposable);
          return disposable;
        },
      });
    }

    return this.history;
  }

  /**
   * Returns the utility service without a permission check.
   *
   * D-20 classifies utilities as pure functions with zero ambient authority,
   * so a plugin needs no manifest permission to call `resolveImports`.
   */
  public getUtilities(): IUtilityService {
    this.utilities ??= Object.freeze(this.requireApi<IUtilityService>(
      CORE_API_NAME.utilities,
      'Utility',
    ));

    return this.utilities;
  }

  /**
   * Returns the scoped terminal handle, or `null` without `terminal:execute`.
   *
   * The lookup is memoized: every activation receives one handle, so its
   * `dispose()` releases exactly the sessions the plugin started.
   */
  public getTerminal(): ITerminalHandle | null {
    if (this.terminalHandle !== undefined) {
      return this.terminalHandle;
    }

    if (!this.permissions.has('terminal:execute')) {
      this.terminalHandle = null;

      return null;
    }

    const terminal = this.resolveApi(CORE_API_NAME.terminal) as ITerminalService | null;

    if (terminal === null) {
      this.terminalHandle = null;

      return null;
    }

    try {
      this.terminalHandle = createTerminalHandle({
        service: terminal,
        callerId: this.pluginId,
        workspaceRoot: this.workspaceRoot,
      });
    } catch {
      // A declared permission without a registered service is a composition
      // gap, not a plugin fault: feature detection must stay total.
      this.terminalHandle = null;
    }

    return this.terminalHandle;
  }

  public registerTool(options: ToolRegistrationOptions): IPluginDisposable {
    this.assertPermission('registerTool', 'tools:register');

    const disposable = this.resolveBrudTools().registerTool(
      this.pluginId,
      this.official,
      options,
    );

    this.subscriptions.add(disposable);

    return disposable;
  }

  public getBrudTools(): IBrudToolsReader {
    this.assertCapability('getBrudTools', 'tools');

    if (this.brudToolsReader === undefined) {
      const tools = this.resolveBrudTools();

      // `ToolRegistry` stores a deep-frozen canonical schema and returns that
      // same object on every projection. Forwarding it here is therefore safe
      // and allocation-free: a reader cannot mutate nested schema properties,
      // and no defensive clone is needed on the read path (F-1).
      this.brudToolsReader = Object.freeze({
        getTool: (name: string): RegisteredToolInfo | undefined => tools.getTool(name),
        listTools: (filter?: ListToolsFilter): readonly RegisteredToolInfo[] =>
          tools.listTools(filter),
      });
    }

    return this.brudToolsReader;
  }

  public async executeTool(
    name: string,
    rawInput: unknown,
    contextOverride?: Partial<IPluginExecutionContext>,
  ): Promise<OperationResult> {
    this.assertPermission('executeTool', 'tools:execute');

    const context: IPluginExecutionContext = {
      workspaceRoot: this.workspaceRoot,
      callerId: this.pluginId,
      signal: contextOverride?.signal,
      permissions: [...this.permissions],
    };

    return this.resolveBrudTools().executeTool(name, rawInput, context);
  }

  /**
   * Registers a UI-only action on behalf of this plugin.
   *
   * The manager is used only as a registration sink. Neither the manager
   * instance nor a handler-free reader is exposed, so a plugin can never list
   * or execute actions.
   */
  public registerAction(options: ActionRegistrationOptions): IPluginDisposable {
    this.assertPermission('registerAction', 'actions:register');

    const disposable = this.resolveActionManager().registerAction(this.pluginId, options);

    this.subscriptions.add(disposable);

    return disposable;
  }

  private resolveActionManager(): IActionManager {
    this.actionManager ??= this.requireApi<IActionManager>(
      CORE_API_NAME.actionManager,
      'ActionManager',
    );

    return this.actionManager;
  }

  private resolveBrudTools(): IBrudToolsService {
    return this.requireApi<IBrudToolsService>(
      CORE_API_NAME.brudTools,
      'Tools',
    );
  }

  /** Resolves and caches one Registry projection by canonical API name. */
  private resolveApi(apiName: string): unknown | null {
    if (this.resolvedApis.has(apiName)) {
      return this.resolvedApis.get(apiName) ?? null;
    }

    const projection = this.capabilities.resolveApi(apiName);

    if (projection === null || projection === undefined) {
      return null;
    }

    this.resolvedApis.set(apiName, projection);

    return projection;
  }

  /** Requires a Registry projection, throwing a composition-gap error when absent. */
  private requireApi<T>(apiName: string, label: string): T {
    const projection = this.resolveApi(apiName);

    if (projection === null) {
      throw new Error(
        `${label} API "${apiName}" is not registered for plugin "${this.pluginId}"`,
      );
    }

    return projection as T;
  }

  /**
   * Enforces one specific permission for an operation whose grant is not
   * interchangeable with its sibling.
   *
   * Registering and executing tools are distinct authorities: holding
   * `tools:register` must never authorize execution and vice versa, so these
   * checks require the exact permission instead of the capability's "any of"
   * set.
   */
  private assertPermission(operation: string, permission: PluginPermission): void {
    if (!this.permissions.has(permission)) {
      throw new PluginPermissionError(this.pluginId, operation, [permission]);
    }
  }

  private assertCapability(operation: string, capability: PluginCapability): void {
    const required = CAPABILITY_PERMISSION_REQUIREMENTS[capability];
    const granted = required.some((permission) => this.permissions.has(permission));

    if (!granted) {
      throw new PluginPermissionError(this.pluginId, operation, required);
    }
  }
}
