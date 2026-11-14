/**
 * Default operation kind for this grammar.
 *
 * A bare `[CALL <name>]` header names no kind, so the syntax supplies the
 * default it defines. This value belongs to the grammar, not to the kernel's
 * open kind mechanism.
 */
export const PARSER_DEFAULT_KIND = 'tool' as const;