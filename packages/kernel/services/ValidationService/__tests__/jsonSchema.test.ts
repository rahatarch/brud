import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_JSON_SCHEMA_LIMITS,
  compileJsonSchema,
} from '../engine/jsonSchema/index.js';
import type {
  CompiledJsonSchema,
  JsonSchemaDefinitionError,
  JsonSchemaViolation,
} from '../engine/jsonSchema/index.js';

function compiled(schema: unknown): CompiledJsonSchema {
  const result = compileJsonSchema(schema);
  assert.ok(result.ok, `schema should compile: ${JSON.stringify(result.ok ? null : result.errors)}`);
  return result.schema;
}

function errorsOf(schema: unknown, limits?: Parameters<typeof compileJsonSchema>[1]): readonly JsonSchemaDefinitionError[] {
  const result = compileJsonSchema(schema, limits);
  assert.equal(result.ok, false, 'schema should be rejected');
  return result.ok ? [] : result.errors;
}

function violations(schema: unknown, value: unknown): readonly JsonSchemaViolation[] {
  const result = compiled(schema).validate(value);
  return result.valid ? [] : result.violations;
}

function assertValid(schema: unknown, value: unknown): void {
  assert.deepEqual(violations(schema, value), [], `expected valid: ${JSON.stringify(value)}`);
}

function assertInvalid(schema: unknown, value: unknown, keyword: string): JsonSchemaViolation {
  const found = violations(schema, value);
  const match = found.find((violation) => violation.keyword === keyword);
  assert.ok(match, `expected a ${keyword} violation, got ${JSON.stringify(found)}`);
  return match;
}

describe('compileJsonSchema — keywords', () => {
  it('type: single names, arrays, and integer vs number', () => {
    assertValid({ type: 'string' }, 'x');
    assertInvalid({ type: 'string' }, 1, 'type');
    assertValid({ type: 'integer' }, 3);
    assertInvalid({ type: 'integer' }, 3.5, 'type');
    assertValid({ type: 'number' }, 3);
    assertValid({ type: 'number' }, 3.5);
    assertValid({ type: ['null', 'boolean'] }, null);
    assertValid({ type: ['null', 'boolean'] }, false);
    assertInvalid({ type: ['null', 'boolean'] }, 0, 'type');
    assertValid({ type: 'array' }, []);
    assertInvalid({ type: 'object' }, [], 'type');
    assertInvalid({ type: 'array' }, {}, 'type');
  });

  it('properties, required, and additionalProperties', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'integer' } },
      required: ['a'],
    };
    assertValid(schema, { a: 'x' });
    assertValid(schema, { a: 'x', extra: true }); // additionalProperties defaults to true (U1-D3)
    const missing = assertInvalid(schema, { b: 1 }, 'required');
    assert.equal(missing.schemaPath, '/required');
    const wrong = assertInvalid(schema, { a: 'x', b: 'no' }, 'type');
    assert.equal(wrong.instancePath, '/b');
    assert.equal(wrong.schemaPath, '/properties/b/type');

    const closed = { ...schema, additionalProperties: false };
    const extra = assertInvalid(closed, { a: 'x', extra: 1 }, 'additionalProperties');
    assert.equal(extra.instancePath, '/extra');

    const typed = { properties: { a: true }, additionalProperties: { type: 'number' } };
    assertValid(typed, { a: 'anything', z: 1 });
    assert.equal(assertInvalid(typed, { z: 'no' }, 'type').schemaPath, '/additionalProperties/type');
  });

  it('enum and const use JSON deep equality', () => {
    assertValid({ enum: ['a', 1, null, { x: [1, 2] }] }, { x: [1, 2] });
    assertInvalid({ enum: ['a', 1] }, 'b', 'enum');
    assertValid({ const: { b: 2, a: 1 } }, { a: 1, b: 2 });
    assertValid({ const: 0 }, -0);
    assertInvalid({ const: [1, 2] }, [2, 1], 'const');
  });

  it('items, minItems, maxItems', () => {
    const schema = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 };
    assertValid(schema, ['a']);
    assertValid(schema, ['a', 'b']);
    assertInvalid(schema, [], 'minItems');
    assertInvalid(schema, ['a', 'b', 'c'], 'maxItems');
    assert.equal(assertInvalid(schema, ['a', 3], 'type').instancePath, '/1');
  });

  it('minimum, maximum, exclusiveMinimum, exclusiveMaximum at their boundaries', () => {
    assertValid({ minimum: 1 }, 1);
    assertInvalid({ minimum: 1 }, 0.5, 'minimum');
    assertValid({ maximum: 1 }, 1);
    assertInvalid({ maximum: 1 }, 1.5, 'maximum');
    assertInvalid({ exclusiveMinimum: 1 }, 1, 'exclusiveMinimum');
    assertValid({ exclusiveMinimum: 1 }, 1.0001);
    assertInvalid({ exclusiveMaximum: 1 }, 1, 'exclusiveMaximum');
    assertValid({ exclusiveMaximum: 1 }, 0.9999);
    assertValid({ minimum: 10 }, 'not a number'); // numeric keywords ignore other types
  });

  it('minLength and maxLength count Unicode code points', () => {
    assertValid({ minLength: 2, maxLength: 2 }, 'ab');
    assertInvalid({ minLength: 2 }, 'a', 'minLength');
    assertInvalid({ maxLength: 2 }, 'abc', 'maxLength');
    assertValid({ maxLength: 1 }, '😀'); // one code point, two UTF-16 units
    assertInvalid({ minLength: 2 }, '😀', 'minLength');
  });

  it('pattern is unanchored and uses Unicode mode', () => {
    assertValid({ pattern: 'b' }, 'abc');
    assertValid({ pattern: '^BR-\\d{8}-\\d{3,}$' }, 'BR-20261030-001');
    assertInvalid({ pattern: '^BR-\\d{8}-\\d{3,}$' }, 'BR-2026-1', 'pattern');
    assertValid({ pattern: '^.$' }, '😀');
  });

  it('oneOf requires exactly one matching branch', () => {
    const schema = { oneOf: [{ type: 'integer' }, { type: 'number', minimum: 10 }] };
    assertValid(schema, 3);
    assertValid(schema, 10.5);
    const two = assertInvalid(schema, 12, 'oneOf');
    assert.match(two.message, /matched 2 of 2/u);
    assert.match(assertInvalid(schema, 'x', 'oneOf').message, /matched 0 of 2/u);
  });

  it('boolean schemas and annotations', () => {
    assertValid(true, { anything: [1] });
    const denied = assertInvalid({ properties: { a: false } }, { a: 1 }, 'type');
    assert.equal(denied.schemaPath, '/properties/a');
    assertValid({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:brud:test',
      title: 'T',
      description: 'D',
      $comment: 'C',
      default: 1,
      examples: [1],
      type: 'integer',
    }, 1);
  });
});

describe('compileJsonSchema — fail closed', () => {
  const unsupported: readonly [string, unknown][] = [
    ['$ref', { $ref: '#/$defs/a' }],
    ['$defs', { $defs: { a: true } }],
    ['anyOf', { anyOf: [true] }],
    ['allOf', { allOf: [true] }],
    ['not', { not: true }],
    ['format', { format: 'email' }],
    ['uniqueItems', { uniqueItems: true }],
    ['patternProperties', { patternProperties: { '^a': true } }],
    ['minProperties', { minProperties: 1 }],
    ['if', { if: true, then: true, else: true }],
  ];

  for (const [keyword, schema] of unsupported) {
    it(`rejects unsupported keyword ${keyword}`, () => {
      const found = errorsOf(schema);
      assert.ok(
        found.some((error) => error.code === 'UNSUPPORTED_KEYWORD' && error.schemaPath === `/${keyword}`),
        JSON.stringify(found),
      );
    });
  }

  it('rejects the tuple form of items and reports nested paths', () => {
    assert.equal(errorsOf({ items: [true, true] })[0]?.code, 'UNSUPPORTED_KEYWORD');
    const nested = errorsOf({ properties: { a: { properties: { b: { format: 'uri' } } } } });
    assert.equal(nested[0]?.schemaPath, '/properties/a/properties/b/format');
  });

  const malformed: readonly [string, unknown][] = [
    ['required not an array', { required: 'x' }],
    ['duplicate required', { required: ['a', 'a'] }],
    ['unknown type name', { type: 'date' }],
    ['empty type array', { type: [] }],
    ['negative minLength', { minLength: -1 }],
    ['fractional maxItems', { maxItems: 1.5 }],
    ['non-numeric minimum', { minimum: '1' }],
    ['empty enum', { enum: [] }],
    ['duplicate enum', { enum: [{ a: 1 }, { a: 1 }] }],
    ['non-string pattern', { pattern: 5 }],
    ['invalid regex', { pattern: '[' }],
    ['empty oneOf', { oneOf: [] }],
    ['properties not an object', { properties: [] }],
  ];

  for (const [label, schema] of malformed) {
    it(`rejects a malformed value: ${label}`, () => {
      assert.equal(errorsOf(schema)[0]?.code, 'INVALID_KEYWORD_VALUE');
    });
  }

  it('never throws on hostile schema inputs', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.properties = { self: cyclic };
    for (const input of [undefined, null, 1, 'x', [], () => true, cyclic, { type: 'string', extra: Symbol('s') }]) {
      assert.doesNotThrow(() => compileJsonSchema(input));
      assert.equal(compileJsonSchema(input).ok, false, String(input));
    }
    assert.equal(errorsOf(true, { maxViolations: 0 })[0]?.code, 'INVALID_SCHEMA');
  });
});

describe('compiled validators — JSON-only values', () => {
  class Point {
    public x = 1;
  }
  const sparse: unknown[] = [1];
  sparse[2] = 3; // index 1 is a hole
  const withAccessor = Object.defineProperty({}, 'secret', { enumerable: true, get: () => 'x' });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  const cases: readonly [string, unknown][] = [
    ['undefined', { a: undefined }],
    ['function', { a: (): void => undefined }],
    ['symbol value', { a: Symbol('s') }],
    ['symbol key', { [Symbol('k')]: 1 }],
    ['bigint', { a: 1n }],
    ['NaN', { a: Number.NaN }],
    ['Infinity', { a: Number.POSITIVE_INFINITY }],
    ['-Infinity', { a: Number.NEGATIVE_INFINITY }],
    ['Date', { a: new Date(0) }],
    ['Map', { a: new Map() }],
    ['class instance', { a: new Point() }],
    ['sparse array', { a: sparse }],
    ['accessor property', withAccessor],
    ['cycle', cyclic],
  ];

  for (const [label, value] of cases) {
    it(`rejects ${label} with a json violation and terminates`, () => {
      const found = violations(true, value);
      assert.equal(found.length, 1);
      assert.equal(found[0]?.keyword, 'json');
    });
  }

  it('does not invoke accessors while inspecting', () => {
    let calls = 0;
    const value = Object.defineProperty({}, 'x', { enumerable: true, get: () => { calls += 1; return 1; } });
    violations(true, value);
    assert.equal(calls, 0);
  });
});

describe('compiled validators — limits (default passes, default + 1 fails)', () => {
  const limits = DEFAULT_JSON_SCHEMA_LIMITS;

  const nestedItems = (levels: number): unknown => {
    let schema: unknown = true;
    for (let i = 0; i < levels; i += 1) {
      schema = { items: schema };
    }
    return schema;
  };

  it(`schema depth ${limits.maxSchemaDepth}`, () => {
    assert.equal(compileJsonSchema(nestedItems(limits.maxSchemaDepth)).ok, true);
    assert.equal(errorsOf(nestedItems(limits.maxSchemaDepth + 1))[0]?.code, 'SCHEMA_LIMIT_EXCEEDED');
  });

  it(`schema nodes ${limits.maxSchemaNodes}`, () => {
    const withChildren = (count: number): unknown => ({
      properties: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, true])),
    });
    assert.equal(compileJsonSchema(withChildren(limits.maxSchemaNodes - 1)).ok, true);
    assert.equal(errorsOf(withChildren(limits.maxSchemaNodes))[0]?.code, 'SCHEMA_LIMIT_EXCEEDED');
  });

  it(`enum values ${limits.maxEnumValues}`, () => {
    const values = (count: number): unknown[] => Array.from({ length: count }, (_, i) => i);
    assert.equal(compileJsonSchema({ enum: values(limits.maxEnumValues) }).ok, true);
    assert.equal(errorsOf({ enum: values(limits.maxEnumValues + 1) })[0]?.code, 'SCHEMA_LIMIT_EXCEEDED');
  });

  it(`pattern length ${limits.maxPatternLength}`, () => {
    assert.equal(compileJsonSchema({ pattern: 'a'.repeat(limits.maxPatternLength) }).ok, true);
    assert.equal(errorsOf({ pattern: 'a'.repeat(limits.maxPatternLength + 1) })[0]?.code, 'UNSAFE_PATTERN');
  });

  it(`value depth ${limits.maxValueDepth}`, () => {
    const nest = (depth: number): unknown => {
      let value: unknown = 0;
      for (let i = 0; i < depth; i += 1) {
        value = [value];
      }
      return value;
    };
    assert.deepEqual(violations(true, nest(limits.maxValueDepth)), []);
    assert.equal(violations(true, nest(limits.maxValueDepth + 1))[0]?.keyword, 'limit');
  });

  it(`value nodes ${limits.maxValueNodes}`, () => {
    assert.deepEqual(violations(true, new Array(limits.maxValueNodes - 1).fill(0)), []);
    assert.equal(violations(true, new Array(limits.maxValueNodes).fill(0))[0]?.keyword, 'limit');
  });

  it(`pattern input length ${limits.maxPatternInputLength} code points`, () => {
    const schema = { pattern: '^a*$' };
    assertValid(schema, 'a'.repeat(limits.maxPatternInputLength));
    const over = violations(schema, 'a'.repeat(limits.maxPatternInputLength + 1));
    assert.deepEqual(over.map((v) => v.keyword), ['limit']);
  });

  it(`violations ${limits.maxViolations}`, () => {
    const closed = { additionalProperties: false };
    const keys = (count: number): Record<string, number> => Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i]));
    const atCap = violations(closed, keys(limits.maxViolations));
    assert.equal(atCap.length, limits.maxViolations);
    assert.ok(atCap.every((v) => v.keyword === 'additionalProperties'));
    const over = violations(closed, keys(limits.maxViolations + 1));
    assert.equal(over.length, limits.maxViolations + 1);
    assert.equal(over[over.length - 1]?.keyword, 'limit');
  });

  it('rejects invalid limit overrides', () => {
    assert.equal(errorsOf(true, { maxValueDepth: -1 })[0]?.code, 'INVALID_SCHEMA');
    assert.equal(errorsOf(true, { nope: 1 } as never)[0]?.code, 'INVALID_SCHEMA');
  });
});

describe('pattern safety screen (U1-D2)', () => {
  for (const unsafe of ['(a+)+$', '(a|aa)*b', '(.*)*', '(a)\\1', '(?<n>a)\\k<n>', '(?<=a)b', '(?<!a)b', '((a+))*', '(x{2,})+']) {
    it(`rejects ${unsafe}`, () => {
      assert.equal(errorsOf({ pattern: unsafe })[0]?.code, 'UNSAFE_PATTERN');
    });
  }

  for (const safe of ['^[a-z0-9._-]+$', '^BR-\\d{8}-\\d{3,}$', '^[0-9a-f]{64}$', '^(ab)?c+$', '^(?:ab){2}$', '[()*+]+', '\\(a+\\)+']) {
    it(`accepts ${safe}`, () => {
      assert.equal(compileJsonSchema({ pattern: safe }).ok, true);
    });
  }
});

describe('compiled validators — determinism and immutability', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'integer' } },
    required: ['a', 'b'],
    additionalProperties: false,
  };

  it('returns identical violations across runs and key orders', () => {
    const validator = compiled(schema);
    const first = validator.validate({ z: 1, b: 'x', y: 2 });
    const second = validator.validate({ y: 2, b: 'x', z: 1 });
    assert.deepEqual(first, second);
    assert.deepEqual(validator.validate({ z: 1, b: 'x', y: 2 }), first);
  });

  it('does not mutate the value or the schema, ignores later schema changes, and is frozen', () => {
    const source = structuredClone(schema);
    const result = compileJsonSchema(source);
    assert.ok(result.ok);
    assert.deepEqual(source, schema);
    assert.equal(Object.isFrozen(result.schema), true);

    const value = { a: 'x', b: 1 };
    const snapshot = structuredClone(value);
    assert.equal(result.schema.validate(value).valid, true);
    assert.deepEqual(value, snapshot);

    (source.properties.a as { type: string }).type = 'integer';
    source.required.push('c');
    assert.equal(result.schema.validate(value).valid, true);

    const failed = result.schema.validate({});
    assert.equal(failed.valid, false);
    if (!failed.valid) {
      assert.equal(Object.isFrozen(failed.violations), true);
      assert.equal(Object.isFrozen(failed.violations[0]), true);
    }
  });

  it('never puts the value into a violation message', () => {
    const secret = 'S3CRET-TOKEN-VALUE';
    const found = violations({ type: 'integer', enum: [1], pattern: '^x$', maxLength: 2 }, secret);
    assert.ok(found.length > 0);
    for (const violation of found) {
      assert.doesNotMatch(JSON.stringify(violation), /S3CRET/u);
    }
  });
});

describe('realistic schema — brud.core.file entry payload', () => {
  const sha = '^[0-9a-f]{64}$';
  const fileEntry = {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 4096 },
      operation: { enum: ['write', 'unlink', 'mkdir', 'patch'] },
      preSha256: { oneOf: [{ type: 'null' }, { type: 'string', pattern: sha }] },
      postSha256: { oneOf: [{ type: 'null' }, { type: 'string', pattern: sha }] },
      preBlob: { type: 'string', pattern: sha },
      postBlob: { type: 'string', pattern: sha },
      isBinary: { type: 'boolean' },
    },
    required: ['path', 'operation', 'preSha256', 'postSha256', 'isBinary'],
    additionalProperties: false,
  };
  const good = {
    path: 'src/app.ts',
    operation: 'write',
    preSha256: null,
    postSha256: 'a'.repeat(64),
    isBinary: false,
  };

  it('accepts a valid entry', () => {
    assertValid(fileEntry, good);
  });

  it('reports every problem in a bad entry with exact paths', () => {
    const found = violations(fileEntry, { ...good, operation: 'chmod', postSha256: 'XYZ', isBinary: 'no', extra: 1 });
    assert.deepEqual(
      found.map((v) => [v.instancePath, v.keyword]),
      [
        ['/operation', 'enum'],
        ['/postSha256', 'oneOf'],
        ['/isBinary', 'type'],
        ['/extra', 'additionalProperties'],
      ],
    );
  });
});

describe('module isolation (zero dependencies, Node-free)', () => {
  it('imports nothing outside engine/jsonSchema', () => {
    const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../engine/jsonSchema');
    const files = readdirSync(directory).filter((name) => name.endsWith('.ts'));
    const specifierPattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gmu;
    const report: string[] = [];

    assert.ok(files.length >= 5, `expected the module files, found ${files.join(', ')}`);

    for (const file of files) {
      const source = readFileSync(join(directory, file), 'utf8');
      for (const match of source.matchAll(specifierPattern)) {
        const specifier = match[1] ?? '';
        const target = resolve(directory, specifier);
        const inside = specifier.startsWith('./') && dirname(target) === directory;
        report.push(`${file} -> ${specifier} ${inside ? 'OK' : 'OUTSIDE'}`);
        assert.ok(inside, `${file} imports "${specifier}" from outside engine/jsonSchema`);
      }
    }

    // Printed so the verification record carries the physical evidence.
    console.log(`[import-isolation] ${files.length} files\n${report.join('\n')}`);
  });
});
