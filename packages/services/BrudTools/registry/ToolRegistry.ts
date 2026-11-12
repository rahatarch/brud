import type { IPluginDisposable } from '../../PluginManager/contracts/IPluginContext.js';
import { deepFreeze } from '../../SettingsService/model/deepFreeze.js';
import {
  compileJsonSchema,
  type JsonSchemaDefinitionError,
} from '../../ValidationService/engine/jsonSchema/index.js';
import {
  ToolDuplicateError,
  ToolNotFoundError,
  ToolQuotaExceededError,
  ToolRegistrationError,
} from '../contracts/errors.js';
import type {
  IPluginExecutionContext,
  ListToolsFilter,
  RegisteredToolInfo,
  ToolRegistrationOptions,
} from '../contracts/IBrudToolsService.js';
import type { OperationResult } from '@brud/kernel';

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
 * Maximum number of live tools a single plugin may register.
 *
 * Bounds per-plugin memory growth so a malicious or buggy plugin cannot flood
 * the registry and exhaust the host process heap (E-3.2).
 */
export const maxToolsPerPlugin = 100;

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
   * @throws ToolQuotaExceededError when the plugin already owns the maximum.
   * @throws ToolDuplicateError when the name is already registered.
   */
  registerTool(
    pluginId: string,
    isOfficial: boolean,
    options: ToolRegistrationOptions,
  ): IPluginDisposable {
    if (this.countByOwner(pluginId) >= maxToolsPerPlugin) {
      throw new ToolQuotaExceededError(pluginId, maxToolsPerPlugin);
    }

    const existing = this.entries.get(options.name);

    if (existing !== undefined) {
      throw new ToolDuplicateError(options.name, existing.ownerPluginId);
    }

    // The caller keeps its own mutable schema object. Registration stores an
    // isolated, canonical JSON copy and deep-freezes it once, so a later read
    // through `IBrudToolsReader` cannot reach back into the registry and
    // mutate another plugin's dispatch contract (F-1).
    const parametersSchema = canonicalizeSchema(options.name, options.parametersSchema);

    const entry: RegisteredToolEntry = Object.freeze({
      name: options.name,
      description: options.description,
      parametersSchema,
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

  /**
   * Counts live registrations owned by a plugin.
   *
   * @param pluginId - Owning plugin identifier.
   */
  private countByOwner(pluginId: string): number {
    let count = 0;

    for (const entry of this.entries.values()) {
      if (entry.ownerPluginId === pluginId) {
        count += 1;
      }
    }

    return count;
  }
}

/**
 * Produces the immutable schema copied into the registry.
 *
 * The schema is cloned through JSON so the registry never aliases the
 * caller's object graph, compiled with the dispatch-time compiler so a schema
 * that could never execute is rejected up front, and then deep-frozen once.
 * Reads return this same frozen object; no per-read cloning is performed.
 *
 * @param toolName - Tool being registered, used in failure messages.
 * @param schema - Caller-provided schema, or `undefined` for an open schema.
 * @returns The canonical, deeply frozen schema.
 * @throws ToolRegistrationError when the schema is circular, not plain JSON,
 * contains an unresolvable `$ref`, or otherwise fails compilation.
 */
function canonicalizeSchema(
  toolName: string,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const source: unknown = schema === undefined ? {} : schema;
  let canonical: unknown;

  try {
    canonical = JSON.parse(JSON.stringify(source));
  } catch (error) {
    if (isCircularSerializationError(error)) {
      throw new ToolRegistrationError(
        toolName,
        'SCHEMA_CIRCULAR',
        `SCHEMA_CIRCULAR: Tool ${toolName} has a circular schema.`,
      );
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new ToolRegistrationError(
      toolName,
      'SCHEMA_NOT_JSON',
      `SCHEMA_NOT_JSON: Tool ${toolName} schema must be plain JSON: ${detail}`,
    );
  }

  // Compile with the dispatch-time JSON Schema compiler. Its default limits
  // (`DEFAULT_JSON_SCHEMA_LIMITS` in
  // `services/ValidationService/engine/jsonSchema/types.ts`) cap a schema at
  // 1000 nodes, counting the root object as one node. A flat object schema can
  // therefore declare at most 999 properties; the 1000th property is rejected
  // with SCHEMA_LIMIT_EXCEEDED, which this function surfaces as SCHEMA_INVALID.
  const compiled = compileJsonSchema(canonical);

  if (!compiled.ok) {
    const detail = compiled.errors.map(formatSchemaError).join('; ');
    const hasReference = compiled.errors.some(
      (error) => error.message.includes('$ref') || error.message.includes('$dynamicRef'),
    );

    if (hasReference) {
      throw new ToolRegistrationError(
        toolName,
        'SCHEMA_REF_UNRESOLVED',
        `SCHEMA_REF_UNRESOLVED: Tool ${toolName} uses an unresolvable $ref; only self-contained schemas are allowed: ${detail}`,
      );
    }

    throw new ToolRegistrationError(
      toolName,
      'SCHEMA_INVALID',
      `SCHEMA_INVALID: Tool ${toolName} has an invalid schema: ${detail}`,
    );
  }

  return deepFreeze(canonical as Record<string, unknown>);
}

/** Whether a JSON serialization failure was caused by an object cycle. */
function isCircularSerializationError(error: unknown): boolean {
  return error instanceof TypeError && /circular/iu.test(error.message);
}

/** Renders one compiler diagnostic with its schema pointer. */
function formatSchemaError(error: JsonSchemaDefinitionError): string {
  return error.schemaPath === ''
    ? error.message
    : `${error.schemaPath}: ${error.message}`;
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
