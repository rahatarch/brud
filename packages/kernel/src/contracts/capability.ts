/**
 * Extensible capability token vocabulary.
 *
 * Capabilities are declared by plugins and claimed by service exposures. They
 * are open strings, like Router operation kinds: the kernel validates their
 * shape, not membership in a closed list. A token is one or more lowercase
 * segments separated by `:`, for example `fs:read` or `photoshop:access`.
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
 * Registration-only capability that matches every caller.
 *
 * A service uses this for genuinely public, zero-authority exposure. It is not
 * a valid declarable plugin permission.
 */
export const PUBLIC_API_CAPABILITY = '*';

/**
 * Validates a declarable capability token.
 *
 * @param value - Untrusted capability.
 * @returns `true` when the value has the accepted capability shape.
 */
export function isCapabilityToken(value: unknown): value is CapabilityToken {
  return typeof value === 'string' && CAPABILITY_TOKEN_PATTERN.test(value);
}

/**
 * Whether a registration capability is the public marker.
 *
 * @param value - Registration capability.
 */
export function isPublicApiCapability(value: string): boolean {
  return value === PUBLIC_API_CAPABILITY;
}