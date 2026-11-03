import type { OperationResult } from '../../../src/contracts/handler.js';
import type { IPluginExecutionContext } from './IBrudToolsService.js';
import type {
  BrudOperation,
  BrudToolName,
} from '../parser/types/operations.js';

/** Terminal status of one routed operation. */
export type RoutedOperationStatus =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'aborted'
  | 'tool_not_found'
  | 'schema_invalid';

/**
 * Outcome of routing one parsed operation.
 *
 * The operation is identified by its open tool name, never by a closed kind
 * union. `operationIndex` is the synthesized document index.
 */
export interface RoutedOperationOutcome {
  readonly operationIndex: string;
  readonly sequence: number;
  readonly toolName: BrudToolName;
  readonly status: RoutedOperationStatus;
  readonly result?: OperationResult;
  readonly error?: string;
}

/** Structured, fail-closed parse failure. */
export interface BrudParseFailure {
  /** Stable machine-readable code. */
  readonly code: string;

  /** Human-readable summary. */
  readonly friendly: string;

  /** Diagnostic detail, including the document line when known. */
  readonly details: string;

  /** Absolute 1-based document line, when the failure is positional. */
  readonly line?: number;
}

/**
 * Options shared by {@link IBrudToolsService.parseInput} and
 * {@link IBrudToolsService.parseAndRoute}.
 */
export interface ParseOptions {
  /**
   * Caller identity, workspace and cancellation used for dispatch.
   *
   * Required for real execution; absent means a zero-workspace parser caller
   * and is only useful for dry runs or previews.
   */
  readonly callerContext?: IPluginExecutionContext;

  /** Stop at the first failed operation. Default `false`. */
  readonly stopOnFailure?: boolean;

  /** Upper bound on parsed operations. Default 1_000. */
  readonly maxOperations?: number;

  /** Parse and validate only; never invoke a handler. Default `false`. */
  readonly dryRun?: boolean;
}

/** Result of a pure scan/parse. */
export type ParseResult =
  | {
      readonly ok: true;
      readonly operations: readonly BrudOperation[];
    }
  | {
      readonly ok: false;
      readonly error: BrudParseFailure;
    };

/** Aggregate status of a routed document. */
export type RouteStatus = 'success' | 'partial' | 'failed' | 'empty';

/** Result of parsing, validating and dispatching a document. */
export interface RouteResult {
  readonly status: RouteStatus;
  readonly operations: readonly RoutedOperationOutcome[];
  readonly parseError?: BrudParseFailure;
  readonly dispatched: number;
  readonly failed: number;
}