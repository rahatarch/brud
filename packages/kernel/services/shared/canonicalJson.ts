/**
 * Canonical JSON helpers for the kernel's integrity-protected documents.
 *
 * Integrity digests must survive key reordering, so serialization is
 * canonical: object keys are sorted, arrays keep their order, and only
 * JSON-native values are accepted.
 */

/** Raised when a value cannot be represented as JSON. */
export class JsonValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonValueError';
  }
}

/** Reports whether a value is a plain JSON object. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}

/**
 * Serializes a value as canonical JSON.
 *
 * @param value - JSON-native value.
 * @param seen - Cycle detector used by recursive calls.
 */
export function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new JsonValueError('Non-finite numbers are not valid JSON');
      }

      return JSON.stringify(value);
    case 'object': {
      if (seen.has(value)) {
        throw new JsonValueError('Circular references are not valid JSON');
      }

      seen.add(value);

      try {
        if (Array.isArray(value)) {
          const items: string[] = [];

          for (let index = 0; index < value.length; index += 1) {
            items.push(canonicalJson(value[index], seen));
          }

          return `[${items.join(',')}]`;
        }

        if (!isPlainRecord(value)) {
          throw new JsonValueError('Only plain objects and arrays are valid JSON');
        }

        const keys = Object.keys(value).sort();
        const entries = keys.map(
          (key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`,
        );

        return `{${entries.join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      throw new JsonValueError(`Unsupported JSON value type: ${typeof value}`);
  }
}

/**
 * Validates and deep-clones a JSON object.
 *
 * @param value - Candidate object.
 * @returns A deeply frozen clone with canonical key order.
 */
export function cloneJsonRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw new JsonValueError('Value must be a plain object');
  }

  const cloned = JSON.parse(canonicalJson(value)) as Record<string, unknown>;

  return deepFreeze(cloned);
}

/** Recursively freezes an object graph. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }

  return value;
}