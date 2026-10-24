import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { PluginPermission } from './permissions.js';

/**
 * A resource a plugin can release when it deactivates.
 */
export interface IPluginDisposable {
  /** Releases the resource. Implementations must be safe to call once. */
  dispose(): void | Promise<void>;
}

/**
 * Ordered registry of plugin-owned disposables.
 *
 * Disposal is deterministic and reverse-registration-ordered, so resources are
 * released in the opposite order they were acquired.
 */
export interface IPluginSubscriptions {
  /**
   * Registers a disposable for reverse-order release.
   *
   * @param disposable - Resource to release when the plugin unloads.
   */
  add(disposable: IPluginDisposable): void;

  /**
   * Releases every registered disposable in reverse registration order.
   *
   * Each disposable is attempted exactly once, even when an earlier release
   * fails.
   */
  disposeAll(): Promise<void>;
}

/**
 * Plugin-scoped logger.
 *
 * Implementations tag every record with the owning plugin identifier and never
 * expose host-internal logging primitives.
 */
export interface IPluginLogger {
  /**
   * Emits an informational record.
   *
   * @param message - Human-readable message.
   * @param meta - Optional structured metadata.
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * Emits a warning record.
   *
   * @param message - Human-readable message.
   * @param meta - Optional structured metadata.
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * Emits an error record.
   *
   * @param message - Human-readable message.
   * @param error - Optional error or failure value.
   */
  error(message: string, error?: unknown): void;
}

/**
 * Capability-gated view of the microkernel handed to a plugin during
 * activation.
 *
 * The context never exposes raw kernel services or the service broker. Every
 * capability handle is a scoped facade projected for this plugin alone, and
 * requesting a handle for an undeclared permission raises
 * `PluginPermissionError`.
 */
export interface IPluginContext {
  /** Identifier of the plugin this context belongs to. */
  readonly pluginId: string;

  /** Absolute path of the workspace the plugin operates in. */
  readonly workspaceRoot: string;

  /** Immutable set of permissions declared in the plugin manifest. */
  readonly permissions: ReadonlySet<PluginPermission>;

  /** Reverse-order registry for resources owned by the plugin. */
  readonly subscriptions: IPluginSubscriptions;

  /** Plugin-scoped logger. */
  readonly logger: IPluginLogger;

  /**
   * Reports whether the manifest declared a permission.
   *
   * @param permission - Permission to check.
   */
  hasPermission(permission: PluginPermission): boolean;

  /**
   * Returns a workspace-scoped filesystem facade.
   *
   * Requires `fs:read` or `fs:write`; write operations remain gated by the
   * facade projection.
   *
   * @throws PluginPermissionError when neither permission was declared.
   */
  getFileSystem(): IBrudFileSystem;

  /**
   * Returns a workspace-scoped universal history facade.
   *
   * Requires `history:read` or `history:write`; mutation operations remain
   * gated by the facade projection.
   *
   * @throws PluginPermissionError when neither permission was declared.
   */
  getUniversalHistory(): IUniversalHistoryService;
}
