/**
 * Recursively freezes an object graph.
 *
 * The traversal walks own property descriptors so nested records, arrays, and
 * symbol-keyed values are all frozen. Primitives are returned unchanged.
 *
 * @typeParam T - Value being frozen.
 * @param value - Object graph to freeze in place.
 * @returns The same value, now deeply frozen.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as unknown as Record<string | symbol, unknown>;

  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);

    if (descriptor !== undefined && 'value' in descriptor) {
      const child: unknown = descriptor.value;
      deepFreeze(child);
    }
  }

  return Object.freeze(value);
}
