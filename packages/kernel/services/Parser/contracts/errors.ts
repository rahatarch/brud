/** Stable, machine-readable codes for Parser failures. */
export type ParserErrorCode = 'PARSER_DISPOSED' | 'PARSE_ERROR' | 'OPERATION_LIMIT_EXCEEDED';

/** Raised when the parser is used after disposal. */
export class ParserDisposedError extends Error {
  public readonly code = 'PARSER_DISPOSED' as const;

  constructor() {
    super('Brud parser has been disposed');
    this.name = 'ParserDisposedError';
  }
}

/** Base class for parser-domain failures other than structural parse errors. */
export abstract class ParserError extends Error {
  public abstract readonly code: ParserErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ParserError';
  }
}

/** Raised when a document exceeds the configured operation bound. */
export class OperationLimitExceededError extends ParserError {
  public readonly code = 'OPERATION_LIMIT_EXCEEDED' as const;

  /** Number of operations the document contained. */
  public readonly observed: number;

  /** Configured maximum. */
  public readonly limit: number;

  /**
   * @param observed - Operations found in the document.
   * @param limit - Configured maximum.
   */
  constructor(observed: number, limit: number) {
    super(`document contains ${String(observed)} operations; the limit is ${String(limit)}`);
    this.name = 'OperationLimitExceededError';
    this.observed = observed;
    this.limit = limit;
  }
}