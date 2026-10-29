/**
 * Line-range arithmetic shared by the read engine and the validator.
 *
 * The semantics are the audited `BrudAPI.validate.lineRange`
 * (`api/index.ts:551-575`) plus the read engine's total-line count
 * (`read-engine:65-68`). Both are reproduced here so the validator and the
 * legacy facade compute identical ranges instead of re-deriving them.
 */

/** Normalized line range. */
export interface LineRange {
  /** 1-indexed start line. */
  readonly startLine: number;
  /** 1-indexed inclusive end line, clamped to `totalLines`. */
  readonly endLine: number;
  /** Total line count of the file. */
  readonly totalLines: number;
}

/** Result of {@link computeLineRange}. */
export type LineRangeOutcome =
  | { readonly ok: true; readonly range: LineRange }
  | { readonly ok: false };

/**
 * Counts lines the way the read engine does.
 *
 * A trailing newline does not start a new line, and an empty file has zero
 * lines. An empty file therefore rejects **any** explicit range, including
 * `start_line: 1`; that is a preserved parity behavior, not a bug fix.
 *
 * @param content - File text.
 */
export function countTotalLines(content: string): number {
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;

  return trimmed.length === 0 ? 0 : (trimmed.match(/\n/gu) ?? []).length + 1;
}

/**
 * Validates and clamps a 1-indexed range.
 *
 * `end_line` beyond the file is clamped, never rejected. `NaN` bounds fall
 * through the comparisons exactly as in the audited implementation, so a
 * `start_line: abc` payload keeps its historical behavior.
 *
 * @param startLine - Requested start, `undefined` means `1`.
 * @param endLine - Requested end, `undefined` means `totalLines`.
 * @param totalLines - Line count of the file.
 */
export function computeLineRange(
  startLine: number | undefined,
  endLine: number | undefined,
  totalLines: number,
): LineRangeOutcome {
  const start = startLine ?? 1;
  const end = endLine ?? totalLines;

  if (start < 1 || start > totalLines) {
    return { ok: false };
  }

  const clampedEnd = Math.min(end, totalLines);

  if (start > clampedEnd) {
    return { ok: false };
  }

  return { ok: true, range: { startLine: start, endLine: clampedEnd, totalLines } };
}

/**
 * Slices file text by a validated range, preserving a trailing newline.
 *
 * @param content - File text.
 * @param range - Validated range.
 */
export function sliceLineRange(content: string, range: LineRange): string {
  const lines = content.split('\n');
  const sliced = lines.slice(range.startLine - 1, range.endLine).join('\n');

  return content.endsWith('\n') ? `${sliced}\n` : sliced;
}
