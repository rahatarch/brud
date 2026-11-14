import type { BrudOperationKind } from '../../../src/contracts/brudOperation.js';

/**
 * One parsed `[BRUD]` operation.
 *
 * This service knows only the wire syntax: an operation carries its
 * synthesized document index, the shared kind token, the name written on the
 * header, and the parameter map. It never resolves a target or a service.
 */
export interface BrudOperation {
  /** 1-based document index synthesized from operation order. */
  readonly index: string;

  /** Shared operation kind, e.g. `tool` or `action`. */
  readonly kind: BrudOperationKind;

  /** Operation name written after the kind, e.g. `read_file`. */
  readonly name: string;

  /** Parsed payload. Protected regions are literal strings. */
  readonly parameters: Readonly<Record<string, unknown>>;
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

/** Bounds accepted by {@link IBrudParserService.parse}. */
export interface BrudParseOptions {
  /** Upper bound on parsed operations. Default 1_000. */
  readonly maxOperations?: number;
}

/** Result of a pure scan/parse. */
export type BrudParseResult =
  | {
      readonly ok: true;
      readonly operations: readonly BrudOperation[];
    }
  | {
      readonly ok: false;
      readonly error: BrudParseFailure;
    };