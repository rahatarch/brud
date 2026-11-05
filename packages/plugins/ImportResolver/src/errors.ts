/** Error raised when import syntax cannot be interpreted. */
export class ImportResolutionError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImportResolutionError';
    this.code = code;
  }
}

/**
 * Builds the error used for an unparseable custom import pattern.
 *
 * @param message - Parser diagnostic.
 */
export function invalidImportSyntaxError(message: string): ImportResolutionError {
  return new ImportResolutionError('INVALID_FIELD', message);
}