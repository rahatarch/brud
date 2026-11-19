/**
 * Freezes a value and every own data property beneath it, in place.
 *
 * @param value - The value to freeze.
 * @returns The same value, frozen.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as unknown as Record<string | symbol, unknown>;

  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);

    if (descriptor !== undefined && 'value' in descriptor) {
      deepFreeze(descriptor.value as unknown);
    }
  }

  return Object.freeze(value);
}
