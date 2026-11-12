import { BRUD_KIND_ACTION } from '@brud/kernel';
import type { OperationResult } from '@brud/kernel';
import type { IServiceLifecycle } from '@brud/kernel';
import type { IRouterService } from '../../Router/contracts/IRouterService.js';
import {
  ActionDisposedError,
  ActionNotFoundError,
  ActionValidationError,
  actionFailureMessage,
} from '../contracts/errors.js';
import type {
  ActionRegistrationOptions,
  IActionDisposable,
  IActionExecutionContext,
  IActionManager,
  RegisteredActionInfo,
} from '../contracts/IActionManager.js';
import { ActionManagerToken } from '../descriptor/tokens.js';
import type { JsonSchemaViolation } from '../../ValidationService/engine/jsonSchema/index.js';
import { ActionRegistry, type RegisteredActionEntry } from '../registry/ActionRegistry.js';
import type { ActionManagerDependencies } from './types.js';

/**
 * Level-1 ActionManager orchestrator.
 *
 * Owns one instance-scoped {@link ActionRegistry} and the schema gate in front
 * of every handler. The service is deliberately unidirectional: it exposes
 * `registerAction` to the plugin manager, and `listActions`/`executeAction`
 * only to the UI-facing daemon. No plugin context ever receives this instance.
 */
export class ActionManagerService implements IActionManager, IServiceLifecycle {
  private readonly registry = new ActionRegistry();

  private readonly dependencies: ActionManagerDependencies;

  private disposed = false;

  /**
   * @param dependencies - Optional diagnostic sink.
   */
  constructor(dependencies: ActionManagerDependencies = {}) {
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

  /** Live registry size, for diagnostics that must not leak handlers. */
  get actionCount(): number {
    return this.registry.size;
  }

  registerAction(
    pluginId: string,
    options: ActionRegistrationOptions,
  ): IActionDisposable {
    this.assertLive();

    return this.registry.registerAction(pluginId, options);
  }

  getAction(name: string): RegisteredActionInfo | undefined {
    if (this.disposed) {
      return undefined;
    }

    return this.registry.getAction(name);
  }

  listActions(): readonly RegisteredActionInfo[] {
    if (this.disposed) {
      return Object.freeze([]);
    }

    return this.registry.listActions();
  }

  async executeAction(
    name: string,
    rawInput: unknown,
    callerContext: IActionExecutionContext,
  ): Promise<OperationResult> {
    const prepared = this.prepareAction(name, rawInput);

    if (!prepared.ok) {
      return prepared.result;
    }

    try {
      return await prepared.entry.execute(normalizeInput(rawInput), callerContext);
    } catch (error) {
      return failed(`ACTION_HANDLER_ERROR: ${describe(error)}`);
    }
  }

  /**
   * Validates a payload against the target action without invoking its handler.
   *
   * @param name - Action name.
   * @param rawInput - Untrusted payload.
   * @returns `success` when the payload is admissible, otherwise `failed`.
   */
  validateAction(name: string, rawInput: unknown): OperationResult {
    const prepared = this.prepareAction(name, rawInput);

    return prepared.ok ? { status: 'success' } : prepared.result;
  }

  /**
   * Claims the `action` kind on the Router.
   *
   * Called by the standard composition during the boot registration window.
   *
   * @param router - Router accepting boot-time registrations.
   */
  registerWithRouter(router: IRouterService): void {
    router.register<IActionManager>({
      kind: BRUD_KIND_ACTION,
      token: ActionManagerToken,
      dispatch: (service, operation, context) => {
        const callerContext: IActionExecutionContext = {
          workspaceRoot: context.workspaceRoot,
          callerId: context.callerId,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
          ...(context.origin === undefined ? {} : { origin: context.origin }),
        };

        const input = { ...operation.parameters };

        return context.dryRun === true
          ? Promise.resolve(service.validateAction(operation.name, input))
          : service.executeAction(operation.name, input, callerContext);
      },
    });
  }

  /**
   * Runs the common lookup and schema gate.
   *
   * @param name - Action name.
   * @param rawInput - Untrusted payload.
   * @returns The executable entry, or a failed result.
   */
  private prepareAction(name: string, rawInput: unknown): PreparedAction {
    if (this.disposed) {
      return { ok: false, result: failed(actionFailureMessage(new ActionDisposedError())) };
    }

    const action = this.registry.getAction(name);

    if (action === undefined) {
      return { ok: false, result: failed(actionFailureMessage(new ActionNotFoundError(name))) };
    }

    const entry = this.registry.getExecutable(name);
    const compiled = entry.compiled;

    if (!compiled.ok) {
      const detail = compiled.errors.map((error) => error.message).join('; ');
      const message = `SCHEMA_INVALID: ${detail}`;

      this.warn(message, { action: name });

      return { ok: false, result: failed(message) };
    }

    const validation = compiled.schema.validate(rawInput);

    if (!validation.valid) {
      return {
        ok: false,
        result: failed(actionFailureMessage(
          new ActionValidationError(name, formatViolations(validation.violations)),
        )),
      };
    }

    return { ok: true, entry };
  }

  /**
   * Refuses mutation after disposal.
   *
   * @throws ActionDisposedError when the service already disposed.
   */
  private assertLive(): void {
    if (this.disposed) {
      throw new ActionDisposedError();
    }
  }

  private warn(message: string, meta: Record<string, unknown>): void {
    this.dependencies.logger?.warn(message, meta);
  }
}

/** Result of the shared lookup and schema gate. */
type PreparedAction =
  | { readonly ok: true; readonly entry: RegisteredActionEntry }
  | { readonly ok: false; readonly result: OperationResult };

/** Builds a `failed` result carrying an ActionManager code. */
function failed(error: string): OperationResult {
  return { status: 'failed', error };
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

/** Renders an unknown thrown value for a diagnostic message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalizes an untrusted payload to the handler's object contract. */
function normalizeInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput !== null && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }

  return {};
}