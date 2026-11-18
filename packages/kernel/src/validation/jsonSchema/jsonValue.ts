/**
 * Plain-JSON value helpers: shape inspection, deep equality, cloning, and
 * JSON Pointer encoding. Pure ECMAScript.
 */
import type { JsonSchemaTypeName, JsonSchemaViolation } from './types.js';

/** Encodes one JSON Pointer reference token (RFC 6901). */
export function pointerToken(token: string | number): string {
  return String(token).replace(/~/gu, '~0').replace(/\//gu, '~1');
}

/** Appends a token to a JSON Pointer. */
export function pointerJoin(base: string, token: string | number): string {
  return `${base}/${pointerToken(token)}`;
}

/** Length in Unicode code points, as JSON Schema counts string length. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) {
    count += 1;
  }
  return count;
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** JSON type of a value already known to be plain JSON. */
export function jsonTypeOf(value: unknown): Exclude<JsonSchemaTypeName, 'number'> | 'number' {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return 'object';
}

export interface JsonInspectionLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

/**
 * Checks that a value is plain JSON: it would survive `JSON.stringify` then
 * `JSON.parse` unchanged. Never invokes user code (accessors are rejected
 * without being read). Stops at the first problem.
 *
 * @returns `null` when the value is plain JSON, otherwise one violation.
 */
export function inspectJsonValue(
  value: unknown,
  limits: JsonInspectionLimits,
): JsonSchemaViolation | null {
  let nodes = 0;
  const ancestors: object[] = [];

  const fail = (
    instancePath: string,
    keyword: 'json' | 'limit',
    message: string,
  ): JsonSchemaViolation => ({ instancePath, schemaPath: '', keyword, message });

  const visit = (current: unknown, path: string, depth: number): JsonSchemaViolation | null => {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      return fail(path, 'limit', `value has more than ${limits.maxNodes} nodes`);
    }
    if (depth > limits.maxDepth) {
      return fail(path, 'limit', `value is nested deeper than ${limits.maxDepth} levels`);
    }

    switch (typeof current) {
      case 'string':
      case 'boolean':
        return null;
      case 'number':
        return Number.isFinite(current) ? null : fail(path, 'json', 'number must be finite');
      case 'undefined':
        return fail(path, 'json', 'undefined is not a JSON value');
      case 'bigint':
        return fail(path, 'json', 'bigint is not a JSON value');
      case 'symbol':
        return fail(path, 'json', 'symbol is not a JSON value');
      case 'function':
        return fail(path, 'json', 'function is not a JSON value');
      default:
        break;
    }

    if (current === null) {
      return null;
    }

    const object = current as object;

    if (ancestors.includes(object)) {
      return fail(path, 'json', 'value contains a cycle');
    }

    if (Object.getOwnPropertySymbols(object).length > 0) {
      return fail(path, 'json', 'symbol-keyed properties are not JSON');
    }

    ancestors.push(object);

    try {
      if (Array.isArray(object)) {
        if (Object.getPrototypeOf(object) !== Array.prototype) {
          return fail(path, 'json', 'array subclasses are not JSON');
        }
        const keys = Object.getOwnPropertyNames(object);
        if (keys.length !== object.length + 1) {
          return fail(path, 'json', 'arrays must be dense with no extra properties');
        }
        for (let index = 0; index < object.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(object, index);
          if (descriptor === undefined) {
            return fail(path, 'json', 'arrays must be dense with no extra properties');
          }
          if (!('value' in descriptor)) {
            return fail(pointerJoin(path, index), 'json', 'accessor properties are not JSON');
          }
          const problem = visit(descriptor.value, pointerJoin(path, index), depth + 1);
          if (problem !== null) {
            return problem;
          }
        }
        return null;
      }

      if (!isPlainObject(object)) {
        return fail(path, 'json', 'only plain objects are JSON objects');
      }

      for (const key of Object.getOwnPropertyNames(object)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (descriptor === undefined) {
          continue;
        }
        if (!descriptor.enumerable) {
          return fail(pointerJoin(path, key), 'json', 'non-enumerable properties are not JSON');
        }
        if (!('value' in descriptor)) {
          return fail(pointerJoin(path, key), 'json', 'accessor properties are not JSON');
        }
        const problem = visit(descriptor.value, pointerJoin(path, key), depth + 1);
        if (problem !== null) {
          return problem;
        }
      }
      return null;
    } finally {
      ancestors.pop();
    }
  };

  return visit(value, '', 0);
}

/** Deep equality for plain JSON values (key order ignored, `-0` equals `0`). */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) {
      return false;
    }
    if (!jsonEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

/** Deep-frozen copy of a plain JSON value. */
export function freezeJsonCopy<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item: unknown) => freezeJsonCopy(item))) as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = freezeJsonCopy(item);
  }
  return Object.freeze(copy) as T;
}
