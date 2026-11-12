import type { BrudOperationKind } from '@brud/kernel';
import type { OperationResult } from '@brud/kernel';
import type { ServiceToken } from '@brud/kernel';
import type {
  BrudOperation,
  BrudParseFailure,
} from '../../Parser/contracts/index.js';

/** Terminal status of one routed operation. */
export type RoutedOperationStatus =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'aborted'
  | 'kind_not_registered';

/** Context handed to a registered kind dispatcher. */
export interface BrudDispatchContext {
  /** Absolute workspace root for the execution. */
  readonly workspaceRoot: string;

  /** Identity of the original caller that requested routing. */
  readonly callerId: string;

  /** Permissions the original caller holds, when known. */
  readonly permissions?: readonly string[];

  /** Cancellation signal of the request, when the transport supplied one. */
  readonly signal?: AbortSignal;

  /** Origin marker of the dispatch surface, when one is known. */
  readonly origin?: string;

  /** Validate only; the target must not execute its handler. */
  readonly dryRun?: boolean;
}

/** Options shared by {@link IRouterService.route} and `dispatch`. */
export interface BrudRouteOptions {
  /** Identity of the original caller. Defaults to the router's caller id. */
  readonly callerId?: string;

  /** Workspace root for dispatch. Defaults to the router's boot workspace. */
  readonly workspaceRoot?: string;

  /** Permissions the original caller holds. */
  readonly permissions?: readonly string[];

  /** Cancellation signal. */
  readonly signal?: AbortSignal;

  /** Origin marker of the dispatch surface. */
  readonly origin?: string;

  /** Stop at the first failed operation. Default `false`. */
  readonly stopOnFailure?: boolean;

  /** Validate only; never invoke a target handler. Default `false`. */
  readonly dryRun?: boolean;

  /** Upper bound on parsed operations. Default 1_000. */
  readonly maxOperations?: number;
}

/** Outcome of routing one parsed operation. */
export interface RoutedOperationOutcome {
  /** Synthesized 1-based document index. */
  readonly operationIndex: string;

  /** Zero-based document position. */
  readonly sequence: number;

  /** Shared kind token. */
  readonly kind: BrudOperationKind;

  /** Operation name written on the header. */
  readonly name: string;

  /** Terminal status of this operation. */
  readonly status: RoutedOperationStatus;

  /** Target result, when a target ran. */
  readonly result?: OperationResult;

  /** Diagnostic message for routing-level failures. */
  readonly error?: string;
}

/** Aggregate status of a routed document. */
export type RouteStatus = 'success' | 'partial' | 'failed' | 'empty';

/** Result of parsing and routing one document. */
export interface BrudRouteResult {
  readonly status: RouteStatus;
  readonly operations: readonly RoutedOperationOutcome[];
  readonly parseError?: BrudParseFailure;
  readonly dispatched: number;
  readonly failed: number;
}

/**
 * Boot-time declaration that a Level-1 service serves an operation kind.
 *
 * The dispatcher receives the broker-projected service instance, the parsed
 * operation, and the caller context. It is registered by the owning service,
 * never by a plugin.
 *
 * @typeParam TService - Public interface carried by {@link token}.
 */
export interface BrudRouteRegistration<TService> {
  /** Kind this service handles, e.g. `tool` or `action`. */
  readonly kind: BrudOperationKind;

  /** Token the Router resolves through the access broker at dispatch time. */
  readonly token: ServiceToken<TService>;

  /**
   * Invokes the service for one operation.
   *
   * @param service - Broker-projected service instance.
   * @param operation - Parsed operation.
   * @param context - Caller context for this dispatch.
   */
  readonly dispatch: (
    service: TService,
    operation: BrudOperation,
    context: BrudDispatchContext,
  ) => Promise<OperationResult>;
}