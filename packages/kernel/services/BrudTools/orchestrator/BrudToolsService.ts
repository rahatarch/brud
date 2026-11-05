import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type { IPluginDisposable } from '../../PluginManager/contracts/IPluginContext.js';
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
import type {
  BrudParseFailure,
  ParseOptions,
  ParseResult,
  RouteResult,
  RoutedOperationOutcome,
} from '../contracts/parsing.js';
import { synthesizeIndex } from '../parser/indexSynthesis.js';
import {
  BrudParseError,
  protectedParametersForSchema,
  scanBrudDocument,
} from '../parser/scanner.js';
import type { BrudOperation } from '../parser/types/operations.js';
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

    const tool = this.registry.getTool(name);

    if (tool === undefined) {
      return failed(toolFailureMessage(new ToolNotFoundError(name)));
    }

    const entry: RegisteredToolEntry = this.registry.getExecutable(name);
    const missing = missingPermissions(entry.requiredPermissions, callerContext.permissions);

    if (missing.length > 0) {
      return failed(toolFailureMessage(
        new ToolPermissionError(entry.name, missing, callerContext.permissions ?? []),
      ));
    }

    // The registered schema is the only payload contract. There is no legacy
    // operation-kind gate and no implicit `index` requirement: a tool accepts
    // exactly what its own `parametersSchema` declares.
    const compiled = compiledSchemaFor(tool.parametersSchema);

    if (!compiled.ok) {
      const detail = compiled.errors.map((error) => error.message).join('; ');
      const message = `SCHEMA_INVALID: ${detail}`;

      this.warn(message, { tool: name });

      return failed(message);
    }

    const validation = compiled.schema.validate(rawInput);

    if (!validation.valid) {
      return failed(toolFailureMessage(
        new ToolValidationError(name, formatViolations(validation.violations)),
      ));
    }

    return entry.execute(normalizeInput(rawInput), callerContext);
  }

  parseInput(rawInput: string, options: ParseOptions = {}): ParseResult {
    if (this.disposed) {
      return { ok: false, error: parseFailure(new ToolDisposedError()) };
    }

    const maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;

    if (!Number.isSafeInteger(maxOperations) || maxOperations < 1) {
      return {
        ok: false,
        error: {
          code: 'PARSE_ERROR',
          friendly: 'invalid operation bound',
          details: `maxOperations must be a positive integer, received ${String(maxOperations)}`,
        },
      };
    }

    try {
      const calls = scanBrudDocument(rawInput, (toolName) =>
        protectedParametersForSchema(this.registry.getTool(toolName)?.parametersSchema));

      if (calls.length > maxOperations) {
        return {
          ok: false,
          error: {
            code: 'OPERATION_LIMIT_EXCEEDED',
            friendly: 'too many operations',
            details: `document contains ${String(calls.length)} operations; the limit is ${String(maxOperations)}`,
          },
        };
      }

      const operations: BrudOperation[] = calls.map((call, sequence) => Object.freeze({
        index: synthesizeIndex(sequence),
        toolName: call.toolName,
        parameters: call.parameters,
      }));

      return { ok: true, operations: Object.freeze(operations) };
    } catch (error) {
      return { ok: false, error: parseFailure(error) };
    }
  }

  async parseAndRoute(rawInput: string, options: ParseOptions = {}): Promise<RouteResult> {
    if (this.disposed) {
      return {
        status: 'failed',
        operations: Object.freeze([]),
        parseError: parseFailure(new ToolDisposedError()),
        dispatched: 0,
        failed: 0,
      };
    }

    const parsed = this.parseInput(rawInput, options);

    if (!parsed.ok) {
      return {
        status: 'failed',
        operations: Object.freeze([]),
        parseError: parsed.error,
        dispatched: 0,
        failed: 0,
      };
    }

    const callerContext = options.callerContext ?? DEFAULT_CALLER_CONTEXT;
    const stopOnFailure = options.stopOnFailure === true;
    const operations: RoutedOperationOutcome[] = [];
    let dispatched = 0;
    let failed = 0;

    for (let sequence = 0; sequence < parsed.operations.length; sequence += 1) {
      const operation = parsed.operations[sequence] as BrudOperation;

      if (callerContext.signal?.aborted === true) {
        appendRemaining(operations, parsed.operations, sequence, 'aborted');
        break;
      }

      const tool = this.registry.getTool(operation.toolName);

      if (tool === undefined) {
        failed += 1;
        operations.push({
          operationIndex: operation.index,
          sequence,
          toolName: operation.toolName,
          status: 'tool_not_found',
          error: `TOOL_NOT_FOUND: tool "${operation.toolName}" is not registered`,
        });

        if (stopOnFailure) {
          appendRemaining(operations, parsed.operations, sequence + 1, 'skipped');
          break;
        }

        continue;
      }

      const compiled = compiledSchemaFor(tool.parametersSchema);

      if (!compiled.ok) {
        failed += 1;
        operations.push({
          operationIndex: operation.index,
          sequence,
          toolName: operation.toolName,
          status: 'schema_invalid',
          error: `SCHEMA_INVALID: ${compiled.errors.map((error) => error.message).join('; ')}`,
        });

        if (stopOnFailure) {
          appendRemaining(operations, parsed.operations, sequence + 1, 'skipped');
          break;
        }

        continue;
      }

      const validation = compiled.schema.validate(operation.parameters);

      if (!validation.valid) {
        failed += 1;
        operations.push({
          operationIndex: operation.index,
          sequence,
          toolName: operation.toolName,
          status: 'schema_invalid',
          error: `SCHEMA_INVALID: ${validation.violations.map((violation) => violation.message).join('; ')}`,
        });

        if (stopOnFailure) {
          appendRemaining(operations, parsed.operations, sequence + 1, 'skipped');
          break;
        }

        continue;
      }

      if (options.dryRun === true) {
        operations.push({
          operationIndex: operation.index,
          sequence,
          toolName: operation.toolName,
          status: 'success',
        });
        continue;
      }

      try {
        // Dispatch a shallow copy so a handler that mutates its input cannot
        // corrupt the frozen parsed operation. Only the protocol `index` is
        // deliberately not injected: the tool's own schema is the contract.
        const result = await this.executeTool(
          operation.toolName,
          { ...operation.parameters },
          callerContext,
        );

        dispatched += 1;

        if (!isValidOperationResult(result)) {
          failed += 1;
          const error = 'HANDLER_INVALID_RESULT: handler returned an invalid result shape';

          operations.push({
            operationIndex: operation.index,
            sequence,
            toolName: operation.toolName,
            status: 'failed',
            error,
            result: { status: 'failed', error },
          });

          if (stopOnFailure) {
            appendRemaining(operations, parsed.operations, sequence + 1, 'skipped');
            break;
          }

          continue;
        }

        operations.push({
          operationIndex: operation.index,
          sequence,
          toolName: operation.toolName,
          status: result.status,
          result,
        });

        if (result.status === 'failed') {
          failed += 1;

          if (stopOnFailure) {
            appendRemaining(operations, parsed.operations, sequence + 1, 'skipped');
            break;
          }
        }
      } catch (error) {
        failed += 1;
        operations.push({
          operationIndex: operation.index,
          sequence,
          toolName: operation.toolName,
          status: 'failed',
          error: `TOOL_HANDLER_ERROR: ${describe(error)}`,
        });

        if (stopOnFailure) {
          appendRemaining(operations, parsed.operations, sequence + 1, 'skipped');
          break;
        }
      }
    }

    return {
      status: aggregateStatus(operations),
      operations: Object.freeze(operations),
      dispatched,
      failed,
    };
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

/** Default DoS bound for one parsed document. */
const DEFAULT_MAX_OPERATIONS = 1_000;

/** Parser-owned fallback context for dry runs and previews. */
const DEFAULT_CALLER_CONTEXT: IPluginExecutionContext = Object.freeze({
  workspaceRoot: '',
  callerId: 'brud.parser',
});

/** Converts a thrown scanner failure into the public parse-failure shape. */
function parseFailure(error: unknown): BrudParseFailure {
  if (error instanceof BrudParseError) {
    return {
      code: error.code,
      friendly: error.message,
      details: error.message,
      line: error.line,
    };
  }

  if (error instanceof Error && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;

    if (typeof code === 'string') {
      return { code, friendly: error.message, details: error.message };
    }
  }

  return {
    code: 'PARSE_ERROR',
    friendly: describe(error),
    details: describe(error),
  };
}

/** Appends outcomes for operations that were never attempted. */
function appendRemaining(
  outcomes: RoutedOperationOutcome[],
  operations: readonly BrudOperation[],
  from: number,
  status: 'aborted' | 'skipped',
): void {
  for (let sequence = from; sequence < operations.length; sequence += 1) {
    const operation = operations[sequence] as BrudOperation;

    outcomes.push({
      operationIndex: operation.index,
      sequence,
      toolName: operation.toolName,
      status,
    });
  }
}

/** Aggregates per-operation outcomes into one document status. */
function aggregateStatus(
  outcomes: readonly RoutedOperationOutcome[],
): RouteResult['status'] {
  if (outcomes.length === 0) {
    return 'empty';
  }

  const successes = outcomes.filter((outcome) => outcome.status === 'success').length;

  if (successes === outcomes.length) {
    return 'success';
  }

  if (successes === 0) {
    return 'failed';
  }

  return 'partial';
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

/** Whether a handler returned a structurally valid {@link OperationResult}. */
function isValidOperationResult(value: unknown): value is OperationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as {
    readonly status?: unknown;
    readonly message?: unknown;
    readonly error?: unknown;
    readonly durationMs?: unknown;
  };

  if (candidate.status !== 'success' && candidate.status !== 'failed') {
    return false;
  }

  if (candidate.message !== undefined && typeof candidate.message !== 'string') {
    return false;
  }

  if (
    candidate.error !== undefined
    && typeof candidate.error !== 'string'
    && !(candidate.error instanceof Error)
  ) {
    return false;
  }

  if (
    candidate.durationMs !== undefined
    && (typeof candidate.durationMs !== 'number' || !Number.isFinite(candidate.durationMs))
  ) {
    return false;
  }

  return true;
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
