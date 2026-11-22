import type { BrudOperationKind } from '../../../src/contracts/brudOperation.js';
import type { OperationResult } from '../../../src/contracts/handler.js';
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
  | 'kind_not_registered'
  | 'operation_not_declared'
  | 'permission_denied';

/**
 * The real caller of a routed operation, captured by the Router from the
 * kernel call chain (delegation by the owner). Never supplied by the caller.
 */
export interface BrudDispatchCaller {
  readonly identity: string | null;
  readonly callerClass: string;
  readonly official: boolean;
  readonly capabilities: ReadonlySet<string>;
  readonly origin: string;
}

/** Context handed to a kind owner's dispatch exposure for one operation. */
export interface BrudDispatchContext {
  /** Kernel-derived caller of the route request. */
  readonly caller: BrudDispatchCaller;
  /** Cancellation signal, when the transport supplied one. */
  readonly signal?: AbortSignal;
  /** Validate only; do not execute. */
  readonly dryRun?: boolean;
}

/**
 * Options for one route request. Caller identity and capabilities are not
 * options: the Router takes them from the kernel call chain.
 */
export interface BrudRouteOptions {
  readonly signal?: AbortSignal;
  readonly stopOnFailure?: boolean;
  readonly dryRun?: boolean;
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
 * A kind and the exposure that dispatches it, registered at boot. Each
 * operation is dispatched through that exposure, which is looked up on the
 * kernel call chain.
 */
export interface BrudRouteRegistration {
  readonly kind: BrudOperationKind;
  /** Name of the owner's dispatch exposure (`name`, major `version`). */
  readonly exposure: string;
  readonly version?: number;
  /** Public description declared with the kind. */
  readonly description?: string;
  /**
   * Every operation the kind serves. Required: an operation not listed here is
   * refused before the owner is reached.
   */
  readonly operations: Readonly<Record<string, BrudKindOperation>> | 'open';
  /**
   * Default permission for operations that declare none (a Layer 1 policy
   * object). Required when `operations` is `'open'`: the owner defines the
   * names, and this permission is enforced on every call.
   */
  readonly permission?: Readonly<Record<string, unknown>>;
}

/** One declared operation of a kind. */
export interface BrudKindOperation {
  readonly description?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  /** Who may call it (a Layer 1 policy object). Falls back to the kind's. */
  readonly permission?: Readonly<Record<string, unknown>>;
}

/** One operation as remote clients see it. The permission is not public. */
export interface BrudPublicKindOperation {
  readonly description?: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

/** One kind as remote clients see it: the public vocabulary of Brud syntax. */
export interface BrudKindInfo {
  readonly kind: BrudOperationKind;
  readonly description?: string;
  readonly operations?: Readonly<Record<string, BrudPublicKindOperation>>;
  /** True when the owner defines the operation names itself, so none are listed. */
  readonly open?: true;
}

/** The surface a kind owner's dispatch exposure must provide. */
export interface BrudKindDispatcher {
  dispatch(operation: BrudOperation, context: BrudDispatchContext): Promise<OperationResult> | OperationResult;
}