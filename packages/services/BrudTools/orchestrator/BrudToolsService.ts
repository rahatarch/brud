import { BRUD_KIND_TOOL } from '@brud/kernel';
import type { OperationResult } from '@brud/kernel';
import type { IServiceLifecycle } from '@brud/kernel';
import type { IPluginDisposable } from '../../PluginManager/contracts/IPluginContext.js';
import type { IRouterService } from '../../Router/contracts/IRouterService.js';
import {
  ToolDisposedError,
  ToolNotFoundError,
  ToolPermissionError,
  ToolValidationError,
  toolFailureMessage,
} from '../contracts/errors.js';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
  ListToolsFilter,
  RegisteredToolInfo,
  ToolRegistrationOptions,
} from '../contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../descriptor/tokens.js';
import { ToolRegistry, type RegisteredToolEntry } from '../registry/ToolRegistry.js';
import type { JsonSchemaViolation } from '../../ValidationService/engine/jsonSchema/index.js';
import { compiledSchemaFor } from './schemaValidator.js';
import type { BrudToolsDependencies } from './types.js';

/**
 * Level-1 BrudTools orchestrator.
 *
 * Owns one instance-scoped {@link ToolRegistry} and the schema gate in front of
 * every handler. The access broker only serves requests while the kernel is
 * RUNNING, so the validation dependency is resolved lazily by the descriptor
 * on first dispatch, never during construction.
 *
 * Syntax parsing is not a responsibility of this service. `brud.core.parser`
 * turns a raw document into operations and `brud.core.router` dispatches the
 * `tool` kind here through {@link registerWithRouter}.
 */
export class BrudToolsService implements IBrudToolsService, IServiceLifecycle {
  private readonly registry = new ToolRegistry();

  private readonly dependencies: BrudToolsDependencies;

  private disposed = false;

  /**
   * @param dependencies - Optional schema gate and diagnostic sink.
   */
  constructor(dependencies: BrudToolsDependencies = {}) {
    this.dependencies = dependencies;
  }

  /** Lifecycle no-op: bootstrap is synchronous. */
  async initialize(): Promise<void> {
    return undefined;
  }

  /** Clears the registry and refuses every later call. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.registry.clear();
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Live registry, for diagnostics that must not leak handlers. */
  get toolCount(): number {
    return this.registry.size;
  }

  registerTool(
    pluginId: string,
    isOfficial: boolean,
    options: ToolRegistrationOptions,
  ): IPluginDisposable {
    this.assertLive();

    return this.registry.registerTool(pluginId, isOfficial, options);
  }

  getTool(name: string): RegisteredToolInfo | undefined {
    if (this.disposed) {
      return undefined;
    }

    return this.registry.getTool(name);
  }

  listTools(filter?: ListToolsFilter): readonly RegisteredToolInfo[] {
    if (this.disposed) {
      return Object.freeze([]);
    }

    return this.registry.listTools(filter);
  }

  async executeTool(
    name: string,
    rawInput: unknown,
    callerContext: IPluginExecutionContext,
  ): Promise<OperationResult> {
    const prepared = this.prepareTool(name, rawInput, callerContext, true);

    if (!prepared.ok) {
      return prepared.result;
    }

    try {
      return await prepared.entry.execute(prepared.input, callerContext);
    } catch (error) {
      // Normalize handler faults before they reach the Router so the stable
      // tool error taxonomy survives the centralized dispatch path.
      return failed(`TOOL_HANDLER_ERROR: ${describe(error)}`);
    }
  }

  /**
   * Validates a payload against the target tool without invoking its handler.
   *
   * This is the dry-run path the Router uses. Lookup, allow-list and schema
   * gate run; the caller permission check is deliberately omitted, matching
   * the historical dry-run contract.
   *
   * @param name - Dispatch name.
   * @param rawInput - Untrusted payload.
   * @param callerContext - Caller context (unused by the schema gate).
   * @returns `success` when the payload is admissible, otherwise `failed`.
   */
  validateTool(
    name: string,
    rawInput: unknown,
    callerContext: IPluginExecutionContext,
  ): OperationResult {
    const prepared = this.prepareTool(name, rawInput, callerContext, false);

    return prepared.ok ? { status: 'success' } : prepared.result;
  }

  /**
   * Claims the `tool` kind on the Router.
   *
   * Called by the standard composition during the boot registration window.
   *
   * @param router - Router accepting boot-time registrations.
   */
  registerWithRouter(router: IRouterService): void {
    router.register<IBrudToolsService>({
      kind: BRUD_KIND_TOOL,
      token: BrudToolsToken,
      dispatch: (service, operation, context) => {
        const callerContext: IPluginExecutionContext = {
          workspaceRoot: context.workspaceRoot,
          callerId: context.callerId,
          ...(context.permissions === undefined ? {} : { permissions: context.permissions }),
          ...(context.signal === undefined ? {} : { signal: context.signal }),
          ...(context.origin === undefined ? {} : { origin: context.origin }),
        };

        // A shallow copy keeps a handler's mutations away from the frozen
        // parsed operation. The protocol index is never injected.
        const input = { ...operation.parameters };

        return context.dryRun === true
          ? Promise.resolve(service.validateTool(operation.name, input, callerContext))
          : service.executeTool(operation.name, input, callerContext);
      },
    });
  }

  /**
   * Refuses mutation after disposal.
   *
   * @throws ToolDisposedError when the service already disposed.
   */
  private assertLive(): void {
    if (this.disposed) {
      throw new ToolDisposedError();
    }
  }

  /**
   * Runs the common lookup, allow-list, permission and schema gate.
   *
   * @param name - Dispatch name.
   * @param rawInput - Untrusted payload.
   * @param callerContext - Caller context.
   * @param enforcePermissions - Whether to apply the caller permission gate.
   * @returns The executable entry and normalized input, or a failed result.
   */
  private prepareTool(
    name: string,
    rawInput: unknown,
    callerContext: IPluginExecutionContext,
    enforcePermissions: boolean,
  ): PreparedTool {
    if (this.disposed) {
      return { ok: false, result: failed(toolFailureMessage(new ToolDisposedError())) };
    }

    const tool = this.registry.getTool(name);

    if (tool === undefined) {
      return { ok: false, result: failed(toolFailureMessage(new ToolNotFoundError(name))) };
    }

    if (!this.isToolAllowed(name)) {
      return {
        ok: false,
        result: failed(
          `TOOL_DISABLED: tool "${name}" is disabled by the toolAllowList setting.`,
        ),
      };
    }

    const entry: RegisteredToolEntry = this.registry.getExecutable(name);

    if (enforcePermissions) {
      const missing = missingPermissions(entry.requiredPermissions, callerContext.permissions);

      if (missing.length > 0) {
        return {
          ok: false,
          result: failed(toolFailureMessage(
            new ToolPermissionError(entry.name, missing, callerContext.permissions ?? []),
          )),
        };
      }
    }

    // The registered schema is the only payload contract. There is no
    // operation-kind gate and no implicit `index` requirement: a tool accepts
    // exactly what its own `parametersSchema` declares.
    const compiled = compiledSchemaFor(tool.parametersSchema);

    if (!compiled.ok) {
      const detail = compiled.errors.map((error) => error.message).join('; ');
      const message = `SCHEMA_INVALID: ${detail}`;

      this.warn(message, { tool: name });

      return { ok: false, result: failed(message) };
    }

    const validation = compiled.schema.validate(rawInput);

    if (!validation.valid) {
      return {
        ok: false,
        result: failed(toolFailureMessage(
          new ToolValidationError(name, formatViolations(validation.violations)),
        )),
      };
    }

    return { ok: true, entry, input: normalizeInput(rawInput) };
  }

  /**
   * Whether the current allow-list permits the named tool.
   *
   * Absent accessor, unavailable settings, an empty map, or a missing key all
   * mean "allow". Only an explicit `false` disables the tool, matching the
   * `settings.toolAllowList[kind] !== false` rule.
   */
  private isToolAllowed(name: string): boolean {
    let allowList: Readonly<Record<string, boolean>> | undefined;

    try {
      allowList = this.dependencies.getToolAllowList?.();
    } catch {
      // Settings are unavailable (for example, standalone construction or a
      // kernel that is not yet RUNNING). Fail open, as the default does.
      return true;
    }

    return allowList?.[name] !== false;
  }

  private warn(message: string, meta: Record<string, unknown>): void {
    this.dependencies.logger?.warn(message, meta);
  }
}

/** Result of the shared pre-dispatch gate. */
type PreparedTool =
  | {
      readonly ok: true;
      readonly entry: RegisteredToolEntry;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      readonly result: OperationResult;
    };

/** Builds a `failed` result carrying a BrudTools code. */
function failed(error: string): OperationResult {
  return { status: 'failed', error };
}

/** Renders an unknown thrown value for a diagnostic message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders schema violations without echoing the rejected value. */
function formatViolations(violations: readonly JsonSchemaViolation[]): string {
  return violations
    .map((violation) => {
      const instancePath = violation.instancePath === '' ? '/' : violation.instancePath;

      return `${violation.keyword} at ${instancePath}: ${violation.message}`;
    })
    .join('; ');
}

/**
 * Returns the required permissions the caller does not hold.
 *
 * An absent or empty requirement set is unrestricted. An absent or empty
 * granted set fails closed for any tool that declares requirements.
 */
function missingPermissions(
  required: readonly string[] | undefined,
  granted: readonly string[] | undefined,
): readonly string[] {
  if (required === undefined || required.length === 0) {
    return [];
  }

  const held = new Set(granted ?? []);

  return required.filter((permission) => !held.has(permission));
}

/** Normalizes an untrusted payload to the handler's object contract. */
function normalizeInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput !== null && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }

  return {};
}