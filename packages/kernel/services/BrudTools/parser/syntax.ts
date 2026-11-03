/** Stable code for every Brud Protocol v2 structural failure. */
export const BRUD_PARSE_ERROR = 'PARSE_ERROR' as const;

/** Bare parameter key: `key: value`. */
export const KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

/** Own-line brace marker: `{name}` or `{/name}`. */
export const BRACE_PATTERN = /^\{([^{}]+)\}$/;

/**
 * Fail-closed scanner error.
 *
 * Carries the document line number so a caller can point at the offending
 * construct without re-scanning the input.
 */
export class BrudParseError extends Error {
  public readonly code = BRUD_PARSE_ERROR;

  /** Absolute 1-based line number in the original document. */
  public readonly line: number;

  /**
   * @param message - Human-readable failure description.
   * @param line - Absolute 1-based line number in the original document.
   */
  constructor(message: string, line: number) {
    super(`${message} (line ${String(line)})`);
    this.name = 'BrudParseError';
    this.line = line;
  }
}