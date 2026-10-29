import type { IPluginDisposable } from '../../PluginManager/contracts/IPluginContext.js';
import {
  ToolDuplicateError,
  ToolNotFoundError,
} from '../contracts/errors.js';
import type {
  IPluginExecutionContext,
  ListToolsFilter,
  RegisteredToolInfo,
  ToolRegistrationOptions,
} from '../contracts/IBrudToolsService.js';
import type { OperationResult } from '../../../src/contracts/handler.js';

/**
 * Internal registration record.
 *
 * Kept private to the registry: only {@link ToolRegistry.getExecutable} hands
 * it out, so the raw handler closure never reaches `getTool`/`listTools`.
 */
export interface RegisteredToolEntry extends RegisteredToolInfo {
  /** Raw handler, dispatchable only through the owning service. */
  readonly execute: ToolRegistrationOptions['execute'];
}

/**
 * Instance-scoped, Map-backed tool registry.
 *
 * There is deliberately no module-level state (rollout plan §4.1 rule 5): two
 * kernels in one process own two registries that share nothing. Registrations
 * are disposable; disposing removes exactly the entry it created and never
 * removes a newer registration that happens to reuse the name.
 */
export class ToolRegistry {
  private readonly entries = new Map<string, RegisteredToolEntry>();

  /**
   * Registers a tool for an owning plugin.
   *
   * @param pluginId - Owning plugin identifier.
   * @param isOfficial - Certification status derived by the kernel.
   * @param options - Tool definition and handler.
   * @returns Disposable that removes the entry exactly once.
   * @throws ToolDuplicateError when the name is already registered.
   */
  registerTool(
    pluginId: string,
    isOfficial: boolean,
    options: ToolRegistrationOptions,
  ): IPluginDisposable {
    const existing = this.entries.get(options.name);

    if (existing !== undefined) {
      throw new ToolDuplicateError(options.name, existing.ownerPluginId);
    }

    const entry: RegisteredToolEntry = Object.freeze({
      name: options.name,
      description: options.description,
      parametersSchema: Object.freeze({ ...options.parametersSchema }),
      requiredPermissions: options.requiredPermissions === undefined
        ? undefined
        : Object.freeze([...options.requiredPermissions]),
      ownerPluginId: pluginId,
      isOfficial,
      execute: options.execute,
    });
    this.entries.set(entry.name, entry);

    let disposed = false;

    return {
      dispose: (): void => {
        if (disposed) {
          return;
        }

        disposed = true;

        // Identity check: a later registration of the same name must survive
        // the disposal of the entry it replaced.
        if (this.entries.get(entry.name) === entry) {
          this.entries.delete(entry.name);
        }
      },
    };
  }

  /**
   * Returns the safe projection of a tool, without its handler.
   *
   * @param name - Dispatch name.
   */
  getTool(name: string): RegisteredToolInfo | undefined {
    const entry = this.entries.get(name);

    return entry === undefined ? undefined : project(entry);
  }

  /**
   * Lists the safe projections of registered tools.
   *
   * @param filter - Optional official-only restriction.
   */
  listTools(filter?: ListToolsFilter): readonly RegisteredToolInfo[] {
    const officialOnly = filter?.officialOnly === true;
    const projected: RegisteredToolInfo[] = [];

    for (const entry of this.entries.values()) {
      if (!officialOnly || entry.isOfficial) {
        projected.push(project(entry));
      }
    }

    return Object.freeze(projected);
  }

  /**
   * Returns the internal entry, handler included.
   *
   * @param name - Dispatch name.
   * @throws ToolNotFoundError when the name is not registered.
   */
  getExecutable(name: string): RegisteredToolEntry {
    const entry = this.entries.get(name);

    if (entry === undefined) {
      throw new ToolNotFoundError(name);
    }

    return entry;
  }

  /**
   * Atomically removes every tool owned by a plugin.
   *
   * @param pluginId - Plugin whose registrations are removed.
   */
  removeByOwner(pluginId: string): void {
    for (const [name, entry] of [...this.entries]) {
      if (entry.ownerPluginId === pluginId) {
        this.entries.delete(name);
      }
    }
  }

  /** Number of live registrations. */
  get size(): number {
    return this.entries.size;
  }

  /** Removes every registration. */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * Strips the handler closure from an entry.
 *
 * @param entry - Internal registration record.
 */
function project(entry: RegisteredToolEntry): RegisteredToolInfo {
    return Object.freeze({
      name: entry.name,
      description: entry.description,
      parametersSchema: entry.parametersSchema,
      ...(entry.requiredPermissions === undefined
        ? {}
        : { requiredPermissions: entry.requiredPermissions }),
      ownerPluginId: entry.ownerPluginId,
      isOfficial: entry.isOfficial,
    });
}

/** Re-exported for dispatchers that type their handler result. */
export type ToolHandlerResult = OperationResult;

/** Re-exported for concrete dispatch call sites. */
export type ToolHandlerContext = IPluginExecutionContext;
