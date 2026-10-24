import type { IPluginContext } from './IPluginContext.js';
import type { PluginManifest } from './manifest.js';

/**
 * Contract implemented by every Brud plugin.
 *
 * A plugin is a passive manifest plus lifecycle hooks. It never receives raw
 * kernel services: everything it can reach is exposed through the scoped
 * {@link IPluginContext}.
 */
export interface IBrudPlugin {
  /** Declarative plugin metadata, validated before registration. */
  readonly manifest: PluginManifest;

  /**
   * Starts the plugin.
   *
   * Called once, after every dependency listed in `manifest.dependencies` has
   * activated successfully.
   *
   * @param context - Capability-gated, plugin-scoped kernel view.
   */
  activate(context: IPluginContext): Promise<void> | void;

  /**
   * Stops the plugin.
   *
   * Called in reverse activation order. Resources registered through
   * `context.subscriptions` are disposed by the manager after this hook
   * resolves, so plugins must not rely on `deactivate` being called when
   * activation failed.
   */
  deactivate?(): Promise<void> | void;
}
