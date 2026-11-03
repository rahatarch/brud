/**
 * Synthesizes the document index for a parsed Brud operation.
 *
 * The `[BRUD]` wire grammar has no index marker, so the scanner derives it
 * from document position. `sequence` is zero-based; the first operation is
 * `'1'`, matching the frozen 21-kind matrix which requires `index`.
 *
 * @param sequence - Zero-based document position of the operation.
 * @returns The 1-based index as a decimal string.
 */
export function synthesizeIndex(sequence: number): string {
  return String(sequence + 1);
}
