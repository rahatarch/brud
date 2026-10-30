import type { IBrudPlugin } from './IBrudPlugin.js';

/**
 * Lifecycle state of a registered plugin.
 */
export type PluginState =
  | 'unloaded'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'failed';

/**
 * Immutable snapshot of a registered plugin and its lifecycle state.
 */
export interface PluginRecord {
  /** The registered plugin instance. */
  readonly plugin: IBrudPlugin;

  /** Current lifecycle state. */
  readonly state: PluginState;

  /** ISO 8601 timestamp of the successful activation, when active. */
  readonly activatedAt?: string;

  /** Failure description when the plugin state is `failed`. */
  readonly error?: string;
}

/**
 * Manifest-driven plugin registry and lifecycle supervisor.
 *
 * Registration is passive: plugins are stored exactly as declared and only
 * activated once {@link IPluginManagerService.activateAll} runs. Inside the
 * kernel this happens in the `onRunning` lifecycle hook, after the kernel is
 * `RUNNING` and before `boot()` resolves, so plugins can request capability
 * handles during `activate()`. Activation
 * follows a deterministic topological order derived from
 * `manifest.dependencies`; deactivation disposes plugins in the reverse order.
 */
export interface IPluginManagerService {
  /**
   * Registers a plugin without activating it.
   *
   * @param plugin - Plugin with a validated manifest.
   * @throws PluginDuplicateError when the identifier is already registered.
   * @throws PluginDependencyError when a declared dependency is absent or the
   * registration introduces a cycle.
   */
  register(plugin: IBrudPlugin): void;

  /**
   * Looks up a registered plugin record.
   *
   * @param id - Plugin identifier.
   * @returns The record, or `undefined` when the identifier is unknown.
   */
  getPlugin(id: string): PluginRecord | undefined;

  /**
   * Lists registered plugin records in registration order.
   */
  listPlugins(): readonly PluginRecord[];

  /**
   * Activates every registered plugin in dependency order.
   *
   * Plugins whose dependencies failed are marked `failed` as well; a lifecycle
   * failure does not abort the activation of independent plugins.
   */
  activateAll(): Promise<void>;

  /**
   * Deactivates every active plugin in reverse activation order, then disposes
   * its subscriptions.
   */
  deactivateAll(): Promise<void>;

  /**
   * Resolves the activation order for the currently registered plugins.
   *
   * @returns Plugin identifiers with every dependency before its dependents.
   * The order is deterministic: ties break by registration order.
   * @throws PluginDependencyError when a dependency is missing or a cycle exists.
   */
  resolveActivationOrder(): readonly string[];
}
