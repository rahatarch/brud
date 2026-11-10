import type { BrudParseOptions, BrudParseResult } from './types.js';

/**
 * Level-1 Brud Protocol v2 Parser.
 *
 * Converts a raw `[BRUD]` document into an ordered list of internal
 * operations. The service is deliberately schema-agnostic and routing-agnostic:
 * it neither looks up a tool or action nor knows which service will consume
 * the result.
 */
export interface IBrudParserService {
  /**
   * Scans a raw document into operations without dispatching anything.
   *
   * The parser is fail-closed: a malformed document returns `ok: false` and no
   * partial operation list. Brace regions are captured literally.
   *
   * @param rawInput - Raw model output, including any surrounding prose.
   * @param options - Operation bound.
   */
  parse(rawInput: string, options?: BrudParseOptions): BrudParseResult;
}