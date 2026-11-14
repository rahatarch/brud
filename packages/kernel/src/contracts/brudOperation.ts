/**
 * Operation-kind mechanism.
 *
 * An operation kind is an open, shape-validated token. Any participant may
 * claim a kind and any participant may emit one. The kernel defines only the
 * token's shape; it does not define which kinds exist, which kind is assumed
 * when none is written, or which participant serves a kind. Concrete kind
 * values belong to the participants that claim them.
 */

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
