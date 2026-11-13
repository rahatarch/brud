/**
 * Extensible capability token vocabulary.
 *
 * Capabilities are declared by plugins and claimed by service exposures. They
 * are open strings: the kernel validates their shape, not membership in a
 * closed list. A token is one or more lowercase segments separated by `:`, for
 * example `fs:read` or `photoshop:access`.
 *
 * The kernel provides this mechanism only. A giver that wants a public preset
 * declares it in its own contract; the kernel ships none.
 */

/** Open capability token. */
export type CapabilityToken = string;

/**
 * Shape accepted for capability tokens.
 *
 * Lowercase-only keeps diagnostics and manifest comparisons deterministic.
 */
export const CAPABILITY_TOKEN_PATTERN = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*$/;

/**
 * Validates a declarable capability token.
 *
 * @param value - Untrusted capability.
 * @returns `true` when the value has the accepted capability shape.
 */
export function isCapabilityToken(value: unknown): value is CapabilityToken {
  return typeof value === 'string' && CAPABILITY_TOKEN_PATTERN.test(value);
}