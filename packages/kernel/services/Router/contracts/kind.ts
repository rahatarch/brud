import { BRUD_KIND_PATTERN } from '../../../src/contracts/brudOperation.js';

/**
 * Validates a kind token claimed during the registration window.
 *
 * The shape is the kernel's open kind mechanism. The boot-time claim and the
 * refusal it produces belong to this package.
 */
export function isValidRouterKind(value: string): boolean {
  return BRUD_KIND_PATTERN.test(value);
}