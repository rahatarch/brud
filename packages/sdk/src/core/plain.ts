import { SdkError } from './errors.js';

const MAX_DEPTH = 64;

/**
 * Whether a value is plain JSON — what may cross to a caged participant:
 * null, booleans, finite numbers, strings, arrays and plain objects.
 */
export function isPlainJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isPlainJson(item, depth + 1));
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;

    return (prototype === Object.prototype || prototype === null)
      && Object.values(value).every((item) => isPlainJson(item, depth + 1));
  }

  return false;
}

/**
 * Asserts a value is plain JSON.
 *
 * @throws {SdkError} `SDK_NOT_PLAIN` when it is not.
 */
export function assertPlain<T>(value: T, label = 'value'): T {
  if (!isPlainJson(value)) {
    throw new SdkError('SDK_NOT_PLAIN', `${label} is not plain JSON`);
  }

  return value;
}
