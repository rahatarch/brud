/** Stable code for every Brud Protocol v2 structural failure. */
export const BRUD_PARSE_ERROR = 'PARSE_ERROR' as const;

/** Bare parameter key: `key: value`. */
export const KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

/** Own-line brace marker: `{name}` or `{/name}`. */
export const BRACE_PATTERN = /^\{([^{}]+)\}$/;

/**
 * Call header: `[CALL <name>]` or `[CALL <kind> <name>]`.
 *
 * Group 1 is the first token and group 2 the optional second token. The
 * scanner requires the two-token form and refuses the bare single-token form,
 * because a bare header names no kind.
 */
export const CALL_PATTERN = /^\[CALL\s+([^\s\]]+)(?:\s+([^\s\]]+))?\s*\]$/;

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