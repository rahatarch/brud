import { createHash } from 'node:crypto';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Computes the lowercase hexadecimal SHA-256 digest of a payload.
 *
 * @param data - UTF-8 text or raw bytes.
 */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Reports whether a value is a canonical lowercase SHA-256 digest. */
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}
