/**
 * JSON Schema subset compiler and validator.
 *
 * `compileJsonSchema` checks an untrusted schema once, rejecting every keyword
 * outside the supported subset (fail closed), and returns a frozen validator.
 * Neither function throws, and neither mutates its arguments.
 */
import {
  codePointLength,
  freezeJsonCopy,
  inspectJsonValue,
  jsonEqual,
  jsonTypeOf,
  pointerJoin,
} from './jsonValue.js';
import { screenPattern } from './pattern.js';
import { DEFAULT_JSON_SCHEMA_LIMITS } from './types.js';
import type {
  CompiledJsonSchema,
  JsonSchemaCompileResult,
  JsonSchemaDefinitionError,
  JsonSchemaKeyword,
  JsonSchemaLimits,
  JsonSchemaTypeName,
  JsonSchemaValidationResult,
  JsonSchemaViolation,
} from './types.js';

const TYPE_NAMES: ReadonlySet<string> = new Set<JsonSchemaTypeName>([
  'null', 'boolean', 'number', 'integer', 'string', 'array', 'object',
]);

const CONSTRAINT_KEYWORDS: ReadonlySet<string> = new Set<JsonSchemaKeyword>([
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'const',
  'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'oneOf',
]);

const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  '$schema', '$id', 'title', 'description', '$comment', 'default', 'examples',
]);

/** Compiled, frozen form of one schema node. */
type CompiledNode = boolean | CompiledObjectNode;

interface CompiledObjectNode {
  readonly schemaPath: string;
  readonly types?: readonly JsonSchemaTypeName[];
  readonly properties?: readonly (readonly [string, CompiledNode])[];
  readonly required?: readonly string[];
  readonly additionalProperties?: CompiledNode;
  readonly enumValues?: readonly unknown[];
  readonly hasConst: boolean;
  readonly constValue?: unknown;
  readonly items?: CompiledNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  readonly oneOf?: readonly CompiledNode[];
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveLimits(overrides: Partial<JsonSchemaLimits> | undefined): JsonSchemaLimits | string {
  const merged: Record<string, number> = { ...DEFAULT_JSON_SCHEMA_LIMITS };

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!(key in DEFAULT_JSON_SCHEMA_LIMITS)) {
      return `unknown limit "${key}"`;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      return `limit "${key}" must be a positive integer`;
    }
    merged[key] = value;
  }

  return Object.freeze(merged) as unknown as JsonSchemaLimits;
}

class SchemaCompiler {
  public readonly errors: JsonSchemaDefinitionError[] = [];

  private nodes = 0;

  constructor(private readonly limits: JsonSchemaLimits) {}

  compile(schema: unknown, schemaPath: string, depth: number): CompiledNode {
    this.nodes += 1;
    if (this.nodes > this.limits.maxSchemaNodes) {
      this.error('SCHEMA_LIMIT_EXCEEDED', schemaPath, `schema has more than ${this.limits.maxSchemaNodes} nodes`);
      return false;
    }
    if (depth > this.limits.maxSchemaDepth) {
      this.error('SCHEMA_LIMIT_EXCEEDED', schemaPath, `schema is nested deeper than ${this.limits.maxSchemaDepth} levels`);
      return false;
    }

    if (typeof schema === 'boolean') {
      return schema;
    }
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
      this.error('INVALID_SCHEMA', schemaPath, 'a schema must be an object or a boolean');
      return false;
    }

    const source = schema as Record<string, unknown>;
    const node: Record<string, unknown> = { schemaPath, hasConst: false };

    for (const key of Object.keys(source)) {
      if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
        this.error('UNSUPPORTED_KEYWORD', pointerJoin(schemaPath, key), `keyword "${key}" is not supported`);
      }
    }

    const at = (keyword: string): string => pointerJoin(schemaPath, keyword);
    const has = (keyword: string): boolean => Object.prototype.hasOwnProperty.call(source, keyword);

    if (has('type')) {
      const raw = source.type;
      const list = typeof raw === 'string' ? [raw] : raw;
      if (
        !Array.isArray(list)
        || list.length === 0
        || list.some((name) => typeof name !== 'string' || !TYPE_NAMES.has(name))
        || new Set(list).size !== list.length
      ) {
        this.error('INVALID_KEYWORD_VALUE', at('type'), 'type must be a type name or a non-empty array of unique type names');
      } else {
        node.types = Object.freeze([...list as JsonSchemaTypeName[]]);
      }
    }

    if (has('properties')) {
      const raw = source.properties;
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        this.error('INVALID_KEYWORD_VALUE', at('properties'), 'properties must be an object of schemas');
      } else {
        const entries: (readonly [string, CompiledNode])[] = [];
        for (const [name, child] of Object.entries(raw as Record<string, unknown>)) {
          entries.push(Object.freeze([name, this.compile(child, pointerJoin(at('properties'), name), depth + 1)] as const));
        }
        node.properties = Object.freeze(entries);
      }
    }

    if (has('required')) {
      const raw = source.required;
      if (!Array.isArray(raw) || raw.some((name) => typeof name !== 'string') || new Set(raw).size !== raw.length) {
        this.error('INVALID_KEYWORD_VALUE', at('required'), 'required must be an array of unique strings');
      } else {
        node.required = Object.freeze([...raw as string[]]);
      }
    }

    if (has('additionalProperties')) {
      node.additionalProperties = this.compile(source.additionalProperties, at('additionalProperties'), depth + 1);
    }

    if (has('enum')) {
      const raw = source.enum;
      if (!Array.isArray(raw) || raw.length === 0) {
        this.error('INVALID_KEYWORD_VALUE', at('enum'), 'enum must be a non-empty array');
      } else if (raw.length > this.limits.maxEnumValues) {
        this.error('SCHEMA_LIMIT_EXCEEDED', at('enum'), `enum has more than ${this.limits.maxEnumValues} values`);
      } else if (raw.some((value, index) => raw.findIndex((other) => jsonEqual(other, value)) !== index)) {
        this.error('INVALID_KEYWORD_VALUE', at('enum'), 'enum values must be unique');
      } else {
        node.enumValues = freezeJsonCopy(raw);
      }
    }

    if (has('const')) {
      node.hasConst = true;
      node.constValue = freezeJsonCopy(source.const);
    }

    if (has('items')) {
      if (Array.isArray(source.items)) {
        this.error('UNSUPPORTED_KEYWORD', at('items'), 'the tuple form of items is not supported');
      } else {
        node.items = this.compile(source.items, at('items'), depth + 1);
      }
    }

    for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength'] as const) {
      if (has(keyword)) {
        if (!isNonNegativeInteger(source[keyword])) {
          this.error('INVALID_KEYWORD_VALUE', at(keyword), `${keyword} must be a non-negative integer`);
        } else {
          node[keyword] = source[keyword];
        }
      }
    }

    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const) {
      if (has(keyword)) {
        if (!isFiniteNumber(source[keyword])) {
          this.error('INVALID_KEYWORD_VALUE', at(keyword), `${keyword} must be a finite number`);
        } else {
          node[keyword] = source[keyword];
        }
      }
    }

    if (has('pattern')) {
      const raw = source.pattern;
      if (typeof raw !== 'string') {
        this.error('INVALID_KEYWORD_VALUE', at('pattern'), 'pattern must be a string');
      } else {
        const screened = screenPattern(raw, this.limits.maxPatternLength);
        if (screened.ok) {
          node.pattern = screened.regex;
        } else {
          this.error(screened.code, at('pattern'), screened.reason);
        }
      }
    }

    if (has('oneOf')) {
      const raw = source.oneOf;
      if (!Array.isArray(raw) || raw.length === 0) {
        this.error('INVALID_KEYWORD_VALUE', at('oneOf'), 'oneOf must be a non-empty array of schemas');
      } else {
        node.oneOf = Object.freeze(raw.map((child, index) => this.compile(child, pointerJoin(at('oneOf'), index), depth + 1)));
      }
    }

    return Object.freeze(node) as unknown as CompiledObjectNode;
  }

  private error(code: JsonSchemaDefinitionError['code'], schemaPath: string, message: string): void {
    this.errors.push(Object.freeze({ code, schemaPath, message }));
  }
}

/** Collects violations up to the configured cap. */
class ViolationSink {
  public readonly violations: JsonSchemaViolation[] = [];

  public full = false;

  constructor(private readonly max: number) {}

  add(instancePath: string, schemaPath: string, keyword: JsonSchemaViolation['keyword'], message: string): void {
    if (this.full) {
      return;
    }
    if (this.violations.length === this.max) {
      this.full = true;
      this.violations.push({ instancePath: '', schemaPath: '', keyword: 'limit', message: `more than ${this.max} violations; the rest were omitted` });
      return;
    }
    this.violations.push({ instancePath, schemaPath, keyword, message });
  }
}

function matchesType(value: unknown, types: readonly JsonSchemaTypeName[]): boolean {
  const actual = jsonTypeOf(value);
  return types.some((name) => name === actual || (name === 'number' && actual === 'integer'));
}

function validateNode(
  node: CompiledNode,
  value: unknown,
  instancePath: string,
  schemaPath: string,
  limits: JsonSchemaLimits,
  sink: ViolationSink,
): void {
  if (node === true) {
    return;
  }
  if (node === false) {
    sink.add(instancePath, schemaPath, 'type', 'no value is allowed here');
    return;
  }

  const at = (keyword: string): string => pointerJoin(node.schemaPath, keyword);

  if (node.types !== undefined && !matchesType(value, node.types)) {
    sink.add(instancePath, at('type'), 'type', `must be of type ${node.types.join(' or ')}`);
  }

  if (node.enumValues !== undefined && !node.enumValues.some((candidate) => jsonEqual(candidate, value))) {
    sink.add(instancePath, at('enum'), 'enum', 'must be one of the enumerated values');
  }

  if (node.hasConst && !jsonEqual(node.constValue, value)) {
    sink.add(instancePath, at('const'), 'const', 'must equal the constant value');
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      sink.add(instancePath, at('minimum'), 'minimum', `must be >= ${node.minimum}`);
    }
    if (node.maximum !== undefined && value > node.maximum) {
      sink.add(instancePath, at('maximum'), 'maximum', `must be <= ${node.maximum}`);
    }
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
      sink.add(instancePath, at('exclusiveMinimum'), 'exclusiveMinimum', `must be > ${node.exclusiveMinimum}`);
    }
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {
      sink.add(instancePath, at('exclusiveMaximum'), 'exclusiveMaximum', `must be < ${node.exclusiveMaximum}`);
    }
  }

  if (typeof value === 'string') {
    const needsLength = node.minLength !== undefined || node.maxLength !== undefined || node.pattern !== undefined;
    const length = needsLength ? codePointLength(value) : 0;
    if (node.minLength !== undefined && length < node.minLength) {
      sink.add(instancePath, at('minLength'), 'minLength', `must have at least ${node.minLength} characters`);
    }
    if (node.maxLength !== undefined && length > node.maxLength) {
      sink.add(instancePath, at('maxLength'), 'maxLength', `must have at most ${node.maxLength} characters`);
    }
    if (node.pattern !== undefined) {
      if (length > limits.maxPatternInputLength) {
        sink.add(instancePath, at('pattern'), 'limit', `strings longer than ${limits.maxPatternInputLength} characters are not matched against pattern`);
      } else if (!node.pattern.test(value)) {
        sink.add(instancePath, at('pattern'), 'pattern', 'must match the pattern');
      }
    }
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      sink.add(instancePath, at('minItems'), 'minItems', `must have at least ${node.minItems} items`);
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      sink.add(instancePath, at('maxItems'), 'maxItems', `must have at most ${node.maxItems} items`);
    }
    if (node.items !== undefined) {
      for (let index = 0; index < value.length && !sink.full; index += 1) {
        validateNode(node.items, value[index], pointerJoin(instancePath, index), at('items'), limits, sink);
      }
    }
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const own = (key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

    for (const name of node.required ?? []) {
      if (!own(name)) {
        sink.add(instancePath, at('required'), 'required', `must have required property "${name}"`);
      }
    }

    const declared = new Set<string>();
    for (const [name, child] of node.properties ?? []) {
      declared.add(name);
      if (own(name) && !sink.full) {
        validateNode(child, record[name], pointerJoin(instancePath, name), pointerJoin(at('properties'), name), limits, sink);
      }
    }

    if (node.additionalProperties !== undefined && node.additionalProperties !== true) {
      const extras = Object.keys(record).filter((key) => !declared.has(key)).sort();
      for (const key of extras) {
        if (sink.full) {
          break;
        }
        if (node.additionalProperties === false) {
          sink.add(pointerJoin(instancePath, key), at('additionalProperties'), 'additionalProperties', 'additional properties are not allowed');
        } else {
          validateNode(node.additionalProperties, record[key], pointerJoin(instancePath, key), at('additionalProperties'), limits, sink);
        }
      }
    }
  }

  if (node.oneOf !== undefined && !sink.full) {
    let matches = 0;
    for (const [index, branch] of node.oneOf.entries()) {
      const probe = new ViolationSink(1);
      validateNode(branch, value, instancePath, pointerJoin(at('oneOf'), index), limits, probe);
      if (probe.violations.length === 0) {
        matches += 1;
      }
    }
    if (matches !== 1) {
      sink.add(instancePath, at('oneOf'), 'oneOf', `must match exactly one schema in oneOf (matched ${matches} of ${node.oneOf.length})`);
    }
  }
}

/**
 * Compiles an untrusted JSON Schema into a frozen, reusable validator.
 *
 * @param schema - Schema to compile. It is copied; later changes to it have no effect.
 * @param limits - Optional overrides of {@link DEFAULT_JSON_SCHEMA_LIMITS}.
 */
export function compileJsonSchema(schema: unknown, limits?: Partial<JsonSchemaLimits>): JsonSchemaCompileResult {
  try {
    const resolved = resolveLimits(limits);
    if (typeof resolved === 'string') {
      return { ok: false, errors: [{ code: 'INVALID_SCHEMA', schemaPath: '', message: resolved }] };
    }

    const shape = inspectJsonValue(schema, {
      maxDepth: resolved.maxSchemaDepth * 4,
      maxNodes: resolved.maxSchemaNodes * 64,
    });
    if (shape !== null) {
      return {
        ok: false,
        errors: [{
          code: shape.keyword === 'limit' ? 'SCHEMA_LIMIT_EXCEEDED' : 'INVALID_SCHEMA',
          schemaPath: shape.instancePath,
          message: `schema is not plain JSON: ${shape.message}`,
        }],
      };
    }

    const compiler = new SchemaCompiler(resolved);
    const root = compiler.compile(schema, '', 0);

    if (compiler.errors.length > 0) {
      return { ok: false, errors: Object.freeze([...compiler.errors]) };
    }

    const compiled: CompiledJsonSchema = Object.freeze({
      validate(value: unknown): JsonSchemaValidationResult {
        try {
          const shapeProblem = inspectJsonValue(value, {
            maxDepth: resolved.maxValueDepth,
            maxNodes: resolved.maxValueNodes,
          });
          if (shapeProblem !== null) {
            return { valid: false, violations: Object.freeze([Object.freeze(shapeProblem)]) };
          }

          const sink = new ViolationSink(resolved.maxViolations);
          validateNode(root, value, '', '', resolved, sink);

          return sink.violations.length === 0
            ? { valid: true }
            : { valid: false, violations: Object.freeze(sink.violations.map((violation) => Object.freeze(violation))) };
        } catch {
          return {
            valid: false,
            violations: Object.freeze([Object.freeze({
              instancePath: '',
              schemaPath: '',
              keyword: 'limit' as const,
              message: 'internal validation error',
            })]),
          };
        }
      },
    });

    return { ok: true, schema: compiled };
  } catch {
    return { ok: false, errors: [{ code: 'INVALID_SCHEMA', schemaPath: '', message: 'schema could not be compiled' }] };
  }
}
