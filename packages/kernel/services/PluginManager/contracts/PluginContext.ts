import type {
  IBrudToolsReader,
  IBrudToolsService,
  IPluginExecutionContext,
  ListToolsFilter,
  RegisteredToolInfo,
  ToolRegistrationOptions,
} from '../../BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import type { IUtilityService } from '../../UtilityService/contracts/IUtilityService.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
import { PluginPermissionError } from './errors.js';
import type {
  IPluginContext,
  IPluginDisposable,
  IPluginLogger,
  IPluginSubscriptions,
} from './IPluginContext.js';
import type { ITerminalHandle } from './ITerminalHandle.js';
import type { ITerminalService } from '../../TerminalService/contracts/ITerminalService.js';
import { CAPABILITY_PERMISSION_REQUIREMENTS } from './permissions.js';
import type { PluginCapability, PluginPermission } from './permissions.js';
import { PluginSubscriptions } from './PluginSubscriptions.js';
import { createTerminalHandle } from './TerminalHandle.js';

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

  /** Builds the namespace-bound history handle for the owning plugin. */
  readonly history?: () => NamespaceHistoryHandle;

  /** Resolves the live `brud.core.tools` registry. */
  readonly brudTools?: () => IBrudToolsService;

  /** Resolves the pure `brud.core.utils` service. */
  readonly utilities?: () => IUtilityService;

  /** Resolves the `brud.core.terminal` execution service. */
  readonly terminal?: () => ITerminalService;
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

  private universalHistory: IUniversalHistoryService | undefined;

  private history: NamespaceHistoryHandle | undefined;

  private brudToolsReader: IBrudToolsReader | undefined;

  private utilities: IUtilityService | undefined;

  private terminalHandle: ITerminalHandle | null | undefined;

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

  public getFileSystem(): IBrudFileSystem {
    this.assertCapability('getFileSystem', 'fileSystem');

    this.fileSystem ??= this.capabilities.fileSystem();

    return this.fileSystem;
  }

  public getUniversalHistory(): IUniversalHistoryService {
    this.assertCapability('getUniversalHistory', 'universalHistory');

    if (!this.official) {
      throw new PluginPermissionError(
        this.pluginId,
        'getUniversalHistory',
        CAPABILITY_PERMISSION_REQUIREMENTS.universalHistory,
        'the core session history is reserved for official plugins; use getHistory()',
      );
    }

    this.universalHistory ??= this.capabilities.universalHistory();

    return this.universalHistory;
  }

  public getHistory(): NamespaceHistoryHandle {
    this.assertCapability('getHistory', 'universalHistory');

    const history = this.capabilities.history;

    if (history === undefined) {
      throw new Error('Namespace history capability is not available in this context');
    }

    if (this.history === undefined) {
      const inner = history();
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
    const utilities = this.capabilities.utilities;

    if (utilities === undefined) {
      throw new Error('Utility service is not available in this context');
    }

    this.utilities ??= Object.freeze(utilities());

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

    const terminal = this.capabilities.terminal;

    if (terminal === undefined) {
      this.terminalHandle = null;

      return null;
    }

    try {
      this.terminalHandle = createTerminalHandle({
        service: terminal(),
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

  private resolveBrudTools(): IBrudToolsService {
    const brudTools = this.capabilities.brudTools;

    if (brudTools === undefined) {
      throw new Error('Tools capability is not available in this context');
    }

    return brudTools();
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
