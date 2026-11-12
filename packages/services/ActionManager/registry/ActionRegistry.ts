import { deepFreeze } from '../../SettingsService/model/deepFreeze.js';
import {
  compileJsonSchema,
  type JsonSchemaCompileResult,
  type JsonSchemaDefinitionError,
} from '../../ValidationService/engine/jsonSchema/index.js';
import {
  ActionDuplicateError,
  ActionNotFoundError,
  ActionQuotaExceededError,
  ActionRegistrationError,
} from '../contracts/errors.js';
import type {
  ActionRegistrationOptions,
  IActionDisposable,
  RegisteredActionInfo,
} from '../contracts/IActionManager.js';

/**
 * Internal registration record.
 *
 * Kept private to the registry: only {@link ActionRegistry.getExecutable}
 * hands it out, so the raw handler closure never reaches `getAction`/
 * `listActions`.
 */
export interface RegisteredActionEntry extends RegisteredActionInfo {
  /** Raw handler, dispatchable only through the owning service. */
  readonly execute: ActionRegistrationOptions['execute'];

  /** Compiled schema gate, fixed at registration time. */
  readonly compiled: JsonSchemaCompileResult;
}

/**
 * Maximum number of live actions a single plugin may register.
 *
 * Bounds per-plugin memory growth so a malicious or buggy plugin cannot flood
 * the UI catalog and exhaust the host process heap.
 */
export const maxActionsPerPlugin = 50;

/**
 * Instance-scoped, Map-backed action registry.
 *
 * There is deliberately no module-level state: two kernels in one process own
 * two registries that share nothing. Registrations are disposable; disposing
 * removes exactly the entry it created and never removes a newer registration
 * that happens to reuse the name.
 */
export class ActionRegistry {
  private readonly entries = new Map<string, RegisteredActionEntry>();

  /**
   * Registers an action for an owning plugin.
   *
   * @param pluginId - Owning plugin identifier.
   * @param options - Action definition and handler.
   * @returns Disposable that removes the entry exactly once.
   * @throws ActionQuotaExceededError when the plugin already owns the maximum.
   * @throws ActionDuplicateError when the name is already registered.
   * @throws ActionRegistrationError when the schema cannot be canonicalized.
   */
  registerAction(
    pluginId: string,
    options: ActionRegistrationOptions,
  ): IActionDisposable {
    if (this.countByOwner(pluginId) >= maxActionsPerPlugin) {
      throw new ActionQuotaExceededError(pluginId, maxActionsPerPlugin);
    }

    const existing = this.entries.get(options.name);

    if (existing !== undefined) {
      throw new ActionDuplicateError(options.name, existing.ownerPluginId);
    }

    // Registration stores an isolated, canonical JSON copy and deep-freezes it
    // once, so a later read through a projection cannot reach back into the
    // registry and mutate another plugin's dispatch contract.
    const { schema: parametersSchema, compiled } = canonicalizeSchema(
      options.name,
      options.parametersSchema,
    );

    const entry: RegisteredActionEntry = Object.freeze({
      name: options.name,
      description: options.description,
      parametersSchema,
      ownerPluginId: pluginId,
      execute: options.execute,
      compiled,
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
   * Returns the safe projection of an action, without its handler.
   *
   * @param name - Action name.
   */
  getAction(name: string): RegisteredActionInfo | undefined {
    const entry = this.entries.get(name);

    return entry === undefined ? undefined : project(entry);
  }

  /** Lists the safe projections of registered actions. */
  listActions(): readonly RegisteredActionInfo[] {
    return Object.freeze([...this.entries.values()].map(project));
  }

  /**
   * Returns the internal entry, handler included.
   *
   * @param name - Action name.
   * @throws ActionNotFoundError when the name is not registered.
   */
  getExecutable(name: string): RegisteredActionEntry {
    const entry = this.entries.get(name);

    if (entry === undefined) {
      throw new ActionNotFoundError(name);
    }

    return entry;
  }

  /**
   * Atomically removes every action owned by a plugin.
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
 * The schema is cloned through JSON so the registry never aliases the caller's
 * object graph, compiled with the dispatch-time compiler so a schema that
 * could never execute is rejected up front, and then deep-frozen once.
 *
 * @param actionName - Action being registered, used in failure messages.
 * @param schema - Caller-provided schema.
 * @returns The canonical, deeply frozen schema and its compiled gate.
 * @throws ActionRegistrationError when the schema is circular, not plain JSON,
 * contains an unresolvable `$ref`, or otherwise fails compilation.
 */
function canonicalizeSchema(
  actionName: string,
  schema: Record<string, unknown>,
): { readonly schema: Record<string, unknown>; readonly compiled: JsonSchemaCompileResult } {
  let canonical: unknown;

  try {
    canonical = JSON.parse(JSON.stringify(schema));
  } catch (error) {
    if (isCircularSerializationError(error)) {
      throw new ActionRegistrationError(
        actionName,
        'SCHEMA_CIRCULAR',
        `SCHEMA_CIRCULAR: Action ${actionName} has a circular schema.`,
      );
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new ActionRegistrationError(
      actionName,
      'SCHEMA_NOT_JSON',
      `SCHEMA_NOT_JSON: Action ${actionName} schema must be plain JSON: ${detail}`,
    );
  }

  const compiled = compileJsonSchema(canonical);

  if (!compiled.ok) {
    const detail = compiled.errors.map(formatSchemaError).join('; ');
    const hasReference = compiled.errors.some(
      (error) => error.message.includes('$ref') || error.message.includes('$dynamicRef'),
    );

    if (hasReference) {
      throw new ActionRegistrationError(
        actionName,
        'SCHEMA_REF_UNRESOLVED',
        `SCHEMA_REF_UNRESOLVED: Action ${actionName} uses an unresolvable $ref; only self-contained schemas are allowed: ${detail}`,
      );
    }

    throw new ActionRegistrationError(
      actionName,
      'SCHEMA_INVALID',
      `SCHEMA_INVALID: Action ${actionName} has an invalid schema: ${detail}`,
    );
  }

  return {
    schema: deepFreeze(canonical as Record<string, unknown>),
    compiled,
  };
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
function project(entry: RegisteredActionEntry): RegisteredActionInfo {
  return Object.freeze({
    name: entry.name,
    description: entry.description,
    parametersSchema: entry.parametersSchema,
    ownerPluginId: entry.ownerPluginId,
  });
}