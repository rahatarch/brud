/**
 * Shared operation-kind vocabulary for the `[BRUD]` Parser and Router.
 *
 * The Parser emits a `kind` for every operation; the Router accepts boot-time
 * registrations keyed by the same value. Both services import this module so
 * the vocabulary cannot drift between them.
 *
 * The type is open by design: a future Level-1 peer may claim a new kind at
 * boot. Only the two built-ins are recognised by the current wire grammar's
 * shorthand form.
 */

/** Built-in kind served by `brud.core.tools`. */
export const BRUD_KIND_TOOL = 'tool' as const;

/** Built-in kind served by `brud.core.actions`. */
export const BRUD_KIND_ACTION = 'action' as const;

/** Kind assumed by a bare `[CALL <name>]` header, preserving v2 documents. */
export const BRUD_DEFAULT_KIND = BRUD_KIND_TOOL;

/** Open operation-kind identity. */
export type BrudOperationKind = string;

/** Safe kind token: starts with a letter, then letters, digits, `_` or `-`. */
export const BRUD_KIND_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Validates an untrusted kind token.
 *
 * @param value - Candidate kind.
 * @returns `true` when the token is safe to register and route.
 */
export function isValidBrudKind(value: string): boolean {
  return BRUD_KIND_PATTERN.test(value);
}