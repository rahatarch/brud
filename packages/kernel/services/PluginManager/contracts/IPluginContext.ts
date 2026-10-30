import type {
  IPluginExecutionContext,
  ToolRegistrationOptions,
} from '../../BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
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
   * Returns the core session history service. Official plugins only.
   *
   * Requires `history:read` or `history:write` and the kernel-derived official
   * brand. `history:write` gives the full service; `history:read` gives the
   * read-only facade. Third-party plugins use {@link getHistory} instead, so
   * they never see human sessions or `brud.core.*` entries (D-15 D3, D10).
   *
   * @throws PluginPermissionError when neither permission was declared, or the
   * plugin is not official.
   */
  getUniversalHistory(): IUniversalHistoryService;

  /**
   * Returns a history handle bound to this plugin's own namespace (its id).
   *
   * Requires `history:read` or `history:write`. `history:write` gives a
   * writable handle; `history:read` gives a read-only one whose writes reject
   * with `READ_ONLY_VIOLATION`. Reads only ever return this plugin's sessions
   * and entries.
   *
   * @throws PluginPermissionError when neither permission was declared.
   */
  getHistory(): NamespaceHistoryHandle;

  /**
   * Registers a tool into the live `brud.core.tools` registry on behalf of
   * this plugin.
   *
   * Requires `tools:register`. The owning plugin identifier and the official
   * certification status are supplied by the kernel; neither can be asserted
   * by the caller. The returned disposable is added to
   * {@link IPluginContext.subscriptions} so the tool leaves the registry when
   * the plugin deactivates.
   *
   * @param options - Tool definition and handler.
   * @returns Disposable that removes the tool exactly once.
   * @throws PluginPermissionError when `tools:register` was not declared.
   */
  registerTool(options: ToolRegistrationOptions): IPluginDisposable;

  /**
   * Validates and dispatches a registered tool through `brud.core.tools`.
   *
   * Requires `tools:execute`. The payload is schema-validated by the service
   * before the handler runs; lookup and validation failures resolve to a
   * `failed` result rather than throwing.
   *
   * @param name - Dispatch name of the tool.
   * @param rawInput - Untrusted payload supplied by the plugin.
   * @param contextOverride - Optional cancellation signal and caller override.
   * @returns The tool's operation result.
   * @throws PluginPermissionError when `tools:execute` was not declared.
   */
  executeTool(
    name: string,
    rawInput: unknown,
    contextOverride?: Partial<IPluginExecutionContext>,
  ): Promise<OperationResult>;
}
