import type { KernelCallAuthority } from '../../../src/contracts/callChain.js';
import { isValidRouterKind } from '../contracts/kind.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
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
} from '../contracts/errors.js';
import type { IRouterService } from '../contracts/IRouterService.js';
import type {
  BrudDispatchCaller,
  BrudDispatchContext,
  BrudKindDispatcher,
  BrudRouteOptions,
  BrudRouteRegistration,
  BrudRouteResult,
  RoutedOperationOutcome,
} from '../contracts/types.js';

/** Collaborators injected into {@link RouterService}. */
export interface RouterDependencies {
  /** Resolves a kind owner's dispatch exposure on the current kernel call chain. */
  readonly resolveOwner: (exposure: string, version: number | undefined, owner: string | undefined) => BrudKindDispatcher | null;
  /** Workspace root used when a request omits one. */
  readonly defaultWorkspaceRoot: () => string;
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
  private readonly registrations = new Map<string, BrudRouteRegistration & { readonly owner?: string }>();

  private authority: KernelCallAuthority | undefined;

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
  /** Binds the kernel call chain (hardcore boot). */
  bindAuthority(value: KernelCallAuthority): void {
    this.authority = value;
  }

  /** The kernel-derived caller of the current chain, if any. */
  private currentCaller(): BrudDispatchCaller | undefined {
    const context = this.authority?.current();

    if (context === undefined) {
      return undefined;
    }

    return Object.freeze({
      identity: context.caller.identity,
      callerClass: context.caller.callerClass,
      official: context.caller.official,
      capabilities: Object.freeze([...context.caller.capabilities].sort()),
      origin: context.origin,
    });
  }

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

  /**
   * Registers a kind a participant declared in `manifest.kinds` (hardcore
   * boot). The owner's kernel identity is pinned, so only that participant's
   * exposure can serve the kind.
   */
  registerDeclared(owner: string, declaration: { readonly kind: string; readonly exposure: string; readonly version?: number | string }): void {
    this.register({
      kind: declaration.kind,
      exposure: declaration.exposure,
      ...(declaration.version === undefined ? {} : { version: Number(declaration.version) }),
    }, owner);
  }

  register(registration: BrudRouteRegistration, owner?: string): void {
    if (this.disposed) {
      throw new RouterDisposedError();
    }

    if (this.closed) {
      throw new RouterRegistrationClosedError(registration.kind);
    }

    if (!isValidRouterKind(registration.kind)) {
      throw new RouterInvalidKindError(registration.kind);
    }

    const existing = this.registrations.get(registration.kind);

    if (existing !== undefined) {
      throw new RouterKindCollisionError(registration.kind, existing.exposure);
    }

    if (typeof registration.exposure !== 'string' || registration.exposure.length === 0) {
      throw new RouterInvalidKindError(registration.kind);
    }

    this.registrations.set(registration.kind, Object.freeze({ ...registration, ...(owner === undefined ? {} : { owner }) }));
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
    caller?: BrudDispatchCaller,
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

    return this.dispatch(parsed.operations, options, caller);
  }

  async dispatch(
    operations: readonly BrudOperation[],
    options: BrudRouteOptions = {},
    caller?: BrudDispatchCaller,
  ): Promise<BrudRouteResult> {
    if (this.disposed) {
      return this.failureResult(new RouterDisposedError());
    }

    const routeCaller = caller ?? this.currentCaller();

    

    if (routeCaller === undefined) {

      return this.failureResult({ code: 'ROUTE_NO_CALL_CONTEXT', message: 'routing requires a kernel call chain' });

    }

    

    const context = this.buildDispatchContext(options, routeCaller);
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
        const owner = this.dependencies.resolveOwner(registration.exposure, registration.version, registration.owner);

        if (owner === null) {
          throw new Error(`KIND_OWNER_UNAVAILABLE: exposure "${registration.exposure}" for kind "${operation.kind}" is not resolvable`);
        }

        result = await owner.dispatch(operation, context);
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

  private buildDispatchContext(options: BrudRouteOptions, caller: BrudDispatchCaller): BrudDispatchContext {
    return Object.freeze({
      workspaceRoot: options.workspaceRoot ?? this.dependencies.defaultWorkspaceRoot(),
      caller,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.dryRun === true ? { dryRun: true } : {}),
    });
  }

  private failureResult(error: { readonly code: string; readonly message: string }): BrudRouteResult {
    const parseError: BrudParseFailure = {
      code: error.code as BrudParseFailure['code'],
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