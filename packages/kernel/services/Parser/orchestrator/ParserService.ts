import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import {
  OperationLimitExceededError,
  ParserDisposedError,
} from '../contracts/errors.js';
import type { IBrudParserService } from '../contracts/IParserService.js';
import type {
  BrudOperation,
  BrudParseFailure,
  BrudParseOptions,
  BrudParseResult,
} from '../contracts/types.js';
import { synthesizeIndex } from '../parser/indexSynthesis.js';
import { BrudParseError, scanBrudDocument } from '../parser/scanner.js';

/** Default DoS bound for one parsed document. */
const DEFAULT_MAX_OPERATIONS = 1_000;

/**
 * Level-1 Brud Protocol v2 Parser.
 *
 * Owns the `[BRUD]` scanner and nothing else. It has no registry, no broker
 * dependency, and no knowledge of the kind vocabulary beyond validating the
 * kind token written on the header. Routing belongs to `brud.core.router`.
 */
export class ParserService implements IBrudParserService, IServiceLifecycle {
  private disposed = false;

  /** Lifecycle no-op: bootstrap is synchronous. */
  async initialize(): Promise<void> {
    return undefined;
  }

  /** Refuses every later parse. */
  async dispose(): Promise<void> {
    this.disposed = true;
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  parse(rawInput: string, options: BrudParseOptions = {}): BrudParseResult {
    if (this.disposed) {
      return { ok: false, error: parseFailure(new ParserDisposedError()) };
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
      // The Parser is schema-agnostic: every brace region is opaque. The
      // resolver is still passed so the scanner's protected-region semantics
      // remain one implementation.
      const calls = scanBrudDocument(rawInput, () => undefined);

      if (calls.length > maxOperations) {
        return {
          ok: false,
          error: parseFailure(new OperationLimitExceededError(calls.length, maxOperations)),
        };
      }

      const operations: BrudOperation[] = calls.map((call, sequence) => Object.freeze({
        index: synthesizeIndex(sequence),
        kind: call.kind,
        name: call.name,
        parameters: call.parameters,
      }));

      return { ok: true, operations: Object.freeze(operations) };
    } catch (error) {
      return { ok: false, error: parseFailure(error) };
    }
  }
}

/** Converts a thrown failure into the public parse-failure shape. */
function parseFailure(error: unknown): BrudParseFailure {
  if (error instanceof BrudParseError) {
    return {
      code: error.code,
      friendly: error.message,
      details: error.message,
      line: error.line,
    };
  }

  if (error instanceof OperationLimitExceededError) {
    return {
      code: error.code,
      friendly: 'too many operations',
      details: error.message,
    };
  }

  if (error instanceof ParserDisposedError) {
    return {
      code: error.code,
      friendly: error.message,
      details: error.message,
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

/** Renders an unknown thrown value for a diagnostic message. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}