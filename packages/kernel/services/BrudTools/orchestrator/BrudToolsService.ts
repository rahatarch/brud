import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type { IPluginDisposable } from '../../PluginManager/contracts/IPluginContext.js';
import {
  ToolDisposedError,
  ToolNotFoundError,
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
import { ToolRegistry, type RegisteredToolEntry } from '../registry/ToolRegistry.js';
import type { BrudToolsDependencies, ToolSchemaDecision } from './types.js';

/**
 * Level-1 BrudTools orchestrator.
 *
 * Owns one instance-scoped {@link ToolRegistry} and the schema gate in front of
 * every handler. The access broker only serves requests while the kernel is
 * RUNNING, so the validation dependency is resolved lazily by the descriptor
 * on first dispatch, never during construction.
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
    if (this.disposed) {
      return failed(toolFailureMessage(new ToolDisposedError()));
    }

    let entry: RegisteredToolEntry;

    try {
      entry = this.registry.getExecutable(name);
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return failed(toolFailureMessage(error));
      }

      throw error;
    }

    const input = normalizeInput(rawInput);
    const validateInput = this.dependencies.validateInput;

    if (validateInput !== undefined) {
      let decision: ToolSchemaDecision;

      try {
        decision = validateInput(entry.name, input);
      } catch (error) {
        // A gate fault is a deployment fault, not a caller fault. It must not
        // become a silent `TOOL_VALIDATION_ERROR`, so it fails closed and is
        // reported through the injected sink.
        const message = `schema gate unavailable for tool "${name}": ${describe(error)}`;

        this.warn(message, { tool: name });

        return failed(message);
      }

      if (!decision.ok) {
        const reason = decision.friendly ?? decision.code ?? 'input does not match schema';
        const rejection = new ToolValidationError(name, reason, {
          ...(decision.code === undefined ? {} : { validationCode: decision.code }),
        });

        return failed(toolFailureMessage(rejection));
      }
    }

    return entry.execute(input, callerContext);
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

  private warn(message: string, meta: Record<string, unknown>): void {
    this.dependencies.logger?.warn(message, meta);
  }
}

/** Builds a `failed` result carrying a BrudTools code. */
function failed(error: string): OperationResult {
  return { status: 'failed', error };
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
