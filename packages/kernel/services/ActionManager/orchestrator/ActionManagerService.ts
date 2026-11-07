import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
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
import type { JsonSchemaViolation } from '../../ValidationService/engine/jsonSchema/index.js';
import { ActionRegistry } from '../registry/ActionRegistry.js';
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
    if (this.disposed) {
      return failed(actionFailureMessage(new ActionDisposedError()));
    }

    const action = this.registry.getAction(name);

    if (action === undefined) {
      return failed(actionFailureMessage(new ActionNotFoundError(name)));
    }

    const entry = this.registry.getExecutable(name);
    const compiled = entry.compiled;

    if (!compiled.ok) {
      const detail = compiled.errors.map((error) => error.message).join('; ');
      const message = `SCHEMA_INVALID: ${detail}`;

      this.warn(message, { action: name });

      return failed(message);
    }

    const validation = compiled.schema.validate(rawInput);

    if (!validation.valid) {
      return failed(actionFailureMessage(
        new ActionValidationError(name, formatViolations(validation.violations)),
      ));
    }

    try {
      return await entry.execute(normalizeInput(rawInput), callerContext);
    } catch (error) {
      return failed(`ACTION_HANDLER_ERROR: ${describe(error)}`);
    }
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