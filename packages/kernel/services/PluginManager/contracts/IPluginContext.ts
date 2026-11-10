import type { ActionRegistrationOptions } from '../../ActionManager/contracts/index.js';
import type {
  IBrudToolsReader,
  IPluginExecutionContext,
  ToolRegistrationOptions,
} from '../../BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IPluginHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import type { IUtilityService } from '../../UtilityService/contracts/IUtilityService.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
import type { ITerminalHandle } from './ITerminalHandle.js';
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
   * Resolves any exposed API by name through the Exposed API Registry.
   *
   * The plugin's declared capabilities are applied by the Registry, so a
   * missing grant returns `null` instead of throwing. Core typed getters use
   * the same resolution path and share the cached projection.
   *
   * @param apiName - Registered API name, for example `'filesystem'`.
   * @returns The projection, or `null` when no registration matches.
   */
  resolve<T = unknown>(apiName: string): T | null;

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
   * brand. `history:write` gives the full service, including the Phase 2
   * lifecycle, per-operation reversal, snapshot, and audit-log methods;
   * `history:read` gives the read-only facade, where those mutations reject
   * with `READ_ONLY_VIOLATION`. Third-party plugins use {@link getHistory}
   * instead, so they never see human sessions or `brud.core.*` entries
   * (D-15 D3, D10).
   *
   * @throws PluginPermissionError when neither permission was declared, or the
   * plugin is not official.
   */
  getUniversalHistory(): IPluginHistoryService;

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
   * Returns the `brud.core.utils` Level-1 utility service.
   *
   * Utilities are pure, stateless functions (D-19/D-20), so this method
   * requires no permission: resolving it grants no filesystem, process,
   * settings, history, or tool authority. The service exposes only
   * {@link IUtilityService.resolveImports}.
   *
   * @returns The shared utility service instance.
   */
  getUtilities(): IUtilityService;

  /**
   * Returns a terminal execution handle scoped to this plugin.
   *
   * Requires `terminal:execute`. The handle pins the workspace root as the
   * default working directory and attributes every execution to this plugin,
   * so {@link ITerminalHandle.list}, {@link ITerminalHandle.cancel} and
   * {@link ITerminalHandle.dispose} only observe sessions the plugin started.
   *
   * Unlike the other capability getters this method returns `null` instead of
   * throwing when the permission is absent, so a plugin can feature-detect
   * terminal support without a manifest change.
   *
   * @returns The scoped handle, or `null` when `terminal:execute` is not
   * declared or no terminal service is available.
   */
  getTerminal(): ITerminalHandle | null;

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
   * Returns a read-only view of the live tool registry.
   *
   * Requires `tools:register` or `tools:execute`. The view exposes only
   * `getTool` and `listTools`: it grants no registration or dispatch authority,
   * so catalog-style plugins can describe the registry without acquiring the
   * ability to mutate or invoke it.
   *
   * @returns Read-only registry projection.
   * @throws PluginPermissionError when no tools permission was declared.
   */
  getBrudTools(): IBrudToolsReader;

  /**
   * Validates and dispatches a registered tool through `brud.core.tools`.
   *
   * Requires `tools:execute`. The payload is schema-validated by the service
   * before the handler runs; lookup and validation failures resolve to a
   * `failed` result rather than throwing.
   *
   * The caller's permissions are taken from the plugin manifest, never from
   * `contextOverride`. A tool that declares `requiredPermissions` fails closed
   * with `TOOL_PERMISSION_DENIED` when any of them is missing.
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

  /**
   * Registers a UI-only action into the live `brud.core.actions` registry on
   * behalf of this plugin.
   *
   * Requires `actions:register`. The owning plugin identifier is supplied by
   * the kernel; the caller cannot assert it. The returned disposable is added
   * to {@link IPluginContext.subscriptions} so the action leaves the UI
   * catalog when the plugin deactivates.
   *
   * This is the only ActionManager surface a plugin receives. There is
   * deliberately no `executeAction`, no `getActionManager`, and no action
   * reader: execution belongs exclusively to the UI-facing daemon.
   *
   * @param options - Action definition and handler.
   * @returns Disposable that removes the action exactly once.
   * @throws PluginPermissionError when `actions:register` was not declared.
   */
  registerAction(options: ActionRegistrationOptions): IPluginDisposable;
}
