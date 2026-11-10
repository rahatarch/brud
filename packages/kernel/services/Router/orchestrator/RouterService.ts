import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import { isValidBrudKind } from '../../../src/contracts/brudOperation.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IServiceLifecycle, ServiceContext } from '../../../src/contracts/lifecycle.js';
import type {
  BrudOperation,
  BrudParseFailure,
  IBrudParserService,
} from '../../Parser/contracts/index.js';
import {
  RouterDisposedError,
  RouterInvalidKindError,
  RouterKindCollisionError,
  RouterRegistrationClosedError,
  RouterUnknownServiceError,
} from '../contracts/errors.js';
import type { IRouterService } from '../contracts/IRouterService.js';
import type {
  BrudDispatchContext,
  BrudRouteOptions,
  BrudRouteRegistration,
  BrudRouteResult,
  RoutedOperationOutcome,
} from '../contracts/types.js';

/** Collaborators injected into {@link RouterService}. */
export interface RouterDependencies {
  /** Mediated access broker used to resolve registered services. */
  readonly broker: IKernelAccessBroker;

  /** Router identity used for broker requests. */
  readonly callerContext: ServiceContext;

  /** Lazily resolves `brud.core.parser`. */
  readonly getParser: () => IBrudParserService;
}

/**
 * Level-1 Brud kind Router.
 *
 * The registration window is open only while the kernel is booting. The
 * standard composition calls {@link closeRegistration} at the end of boot,
 * before the kernel announces `RUNNING`; the `onRunning` hook is a second
 * guard for alternate compositions.
 *
 * Dispatch resolves every target through the access broker with the token the
 * owning service supplied, so access policies still apply and a plugin can
 * never be a routing target.
 */
export class RouterService implements IRouterService, IServiceLifecycle {
  private readonly registrations = new Map<string, BrudRouteRegistration<unknown>>();

  private readonly dependencies: RouterDependencies;

  private parser: IBrudParserService | undefined;

  private closed = false;

  private disposed = false;

  /**
   * @param dependencies - Broker, router identity, and lazy parser resolution.
   */
  constructor(dependencies: RouterDependencies) {
    this.dependencies = dependencies;
  }

  /** Lifecycle no-op: registrations arrive from the boot pinner. */
  async initialize(): Promise<void> {
    return undefined;
  }

  /** Seals the window even when no boot pinner ran. */
  async onRunning(): Promise<void> {
    this.closeRegistration();
  }

  /** Clears every claim and refuses later routing. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.closed = true;
    this.registrations.clear();
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  register<TService>(registration: BrudRouteRegistration<TService>): void {
    if (this.disposed) {
      throw new RouterDisposedError();
    }

    if (this.closed) {
      throw new RouterRegistrationClosedError(registration.kind);
    }

    if (!isValidBrudKind(registration.kind)) {
      throw new RouterInvalidKindError(registration.kind);
    }

    const existing = this.registrations.get(registration.kind);

    if (existing !== undefined) {
      throw new RouterKindCollisionError(registration.kind, existing.token.id);
    }

    if (!this.dependencies.broker.hasService(registration.token)) {
      throw new RouterUnknownServiceError(registration.token.id);
    }

    this.registrations.set(
      registration.kind,
      registration as BrudRouteRegistration<unknown>,
    );
  }

  closeRegistration(): void {
    this.closed = true;
  }

  isRegistrationOpen(): boolean {
    return !this.closed && !this.disposed;
  }

  registeredKinds(): readonly string[] {
    return Object.freeze(Array.from(this.registrations.keys()));
  }

  async route(
    rawInput: string,
    options: BrudRouteOptions = {},
  ): Promise<BrudRouteResult> {
    if (this.disposed) {
      return this.failureResult(new RouterDisposedError());
    }

    const parsed = this.resolveParser().parse(
      rawInput,
      options.maxOperations === undefined
        ? {}
        : { maxOperations: options.maxOperations },
    );

    if (!parsed.ok) {
      return {
        status: 'failed',
        operations: Object.freeze([]),
        parseError: parsed.error,
        dispatched: 0,
        failed: 0,
      };
    }

    return this.dispatch(parsed.operations, options);
  }

  async dispatch(
    operations: readonly BrudOperation[],
    options: BrudRouteOptions = {},
  ): Promise<BrudRouteResult> {
    if (this.disposed) {
      return this.failureResult(new RouterDisposedError());
    }

    const context = this.buildDispatchContext(options);
    const stopOnFailure = options.stopOnFailure === true;
    const outcomes: RoutedOperationOutcome[] = [];

    let dispatched = 0;
    let failed = 0;

    for (let sequence = 0; sequence < operations.length; sequence += 1) {
      const operation = operations[sequence] as BrudOperation;

      if (options.signal?.aborted === true) {
        appendRemaining(outcomes, operations, sequence, 'aborted');
        break;
      }

      const registration = this.registrations.get(operation.kind);

      if (registration === undefined) {
        failed += 1;
        outcomes.push({
          operationIndex: operation.index,
          sequence,
          kind: operation.kind,
          name: operation.name,
          status: 'kind_not_registered',
          error: `KIND_NOT_REGISTERED: kind "${operation.kind}" has no registered service`,
        });

        if (stopOnFailure) {
          appendRemaining(outcomes, operations, sequence + 1, 'skipped');
          break;
        }

        continue;
      }

      let result: OperationResult;

      try {
        // The access broker is the only resolution path: the registered token
        // decides the target and its access policy still applies.
        const service = this.dependencies.broker.requestAccess(
          this.dependencies.callerContext,
          registration.token,
        );

        result = await registration.dispatch(service, operation, context);
      } catch (error: unknown) {
        failed += 1;
        outcomes.push({
          operationIndex: operation.index,
          sequence,
          kind: operation.kind,
          name: operation.name,
          status: 'failed',
          error: `ROUTE_DISPATCH_ERROR: ${describe(error)}`,
        });

        if (stopOnFailure) {
          appendRemaining(outcomes, operations, sequence + 1, 'skipped');
          break;
        }

        continue;
      }

      if (!options.dryRun) {
        dispatched += 1;
      }

      if (!isValidOperationResult(result)) {
        failed += 1;
        const error = 'HANDLER_INVALID_RESULT: handler returned an invalid result shape';

        outcomes.push({
          operationIndex: operation.index,
          sequence,
          kind: operation.kind,
          name: operation.name,
          status: 'failed',
          error,
          result: { status: 'failed', error },
        });

        if (stopOnFailure) {
          appendRemaining(outcomes, operations, sequence + 1, 'skipped');
          break;
        }

        continue;
      }

      outcomes.push({
        operationIndex: operation.index,
        sequence,
        kind: operation.kind,
        name: operation.name,
        status: result.status,
        result,
      });

      if (result.status === 'failed') {
        failed += 1;

        if (stopOnFailure) {
          appendRemaining(outcomes, operations, sequence + 1, 'skipped');
          break;
        }
      }
    }

    return {
      status: aggregateStatus(outcomes),
      operations: Object.freeze(outcomes),
      dispatched,
      failed,
    };
  }

  private resolveParser(): IBrudParserService {
    this.parser ??= this.dependencies.getParser();

    return this.parser;
  }

  private buildDispatchContext(options: BrudRouteOptions): BrudDispatchContext {
    return {
      workspaceRoot: options.workspaceRoot ?? this.dependencies.callerContext.workspaceRoot,
      callerId: options.callerId ?? this.dependencies.callerContext.callerId,
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.dryRun === true ? { dryRun: true } : {}),
    };
  }

  private failureResult(error: RouterDisposedError): BrudRouteResult {
    const parseError: BrudParseFailure = {
      code: error.code,
      friendly: error.message,
      details: error.message,
    };

    return {
      status: 'failed',
      operations: Object.freeze([]),
      parseError,
      dispatched: 0,
      failed: 0,
    };
  }
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
      kind: operation.kind,
      name: operation.name,
      status,
    });
  }
}

/** Aggregates per-operation outcomes into one document status. */
function aggregateStatus(
  outcomes: readonly RoutedOperationOutcome[],
): BrudRouteResult['status'] {
  if (outcomes.length === 0) {
    return 'empty';
  }

  const successes = outcomes.filter(
    (outcome) => outcome.status === 'success',
  ).length;

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
  if (error instanceof Error && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;

    if (typeof code === 'string') {
      return `${code}: ${error.message}`;
    }
  }

  return error instanceof Error ? error.message : String(error);
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