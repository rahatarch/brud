/**
 * Zero-dependency JSON Schema subset validator: public types and limits.
 *
 * The module is pure ECMAScript: no `node:*` imports, no packages.
 */

/** Constraint keywords the validator enforces. Anything else is rejected. */
export type JsonSchemaKeyword =
  | 'type'
  | 'properties'
  | 'required'
  | 'additionalProperties'
  | 'enum'
  | 'const'
  | 'items'
  | 'minItems'
  | 'maxItems'
  | 'minimum'
  | 'maximum'
  | 'exclusiveMinimum'
  | 'exclusiveMaximum'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'oneOf';

/** Primitive type names accepted by the `type` keyword. */
export type JsonSchemaTypeName =
  | 'null'
  | 'boolean'
  | 'number'
  | 'integer'
  | 'string'
  | 'array'
  | 'object';

/** Why a schema could not be compiled. */
export type JsonSchemaDefinitionErrorCode =
  | 'UNSUPPORTED_KEYWORD'
  | 'INVALID_KEYWORD_VALUE'
  | 'INVALID_SCHEMA'
  | 'UNSAFE_PATTERN'
  | 'SCHEMA_LIMIT_EXCEEDED';

/** A problem with the schema itself, found at compile time. */
export interface JsonSchemaDefinitionError {
  readonly code: JsonSchemaDefinitionErrorCode;
  /** JSON Pointer into the schema, e.g. `/properties/path/pattern`; `` for the root. */
  readonly schemaPath: string;
  readonly message: string;
}

/** A way in which a value does not satisfy a compiled schema. */
export interface JsonSchemaViolation {
  /** JSON Pointer into the value; `` for the root. */
  readonly instancePath: string;
  /** JSON Pointer to the schema keyword that failed. */
  readonly schemaPath: string;
  /** `json`: the value is not plain JSON. `limit`: a safety limit was reached. */
  readonly keyword: JsonSchemaKeyword | 'json' | 'limit';
  /** Human-readable reason. Never contains the value itself. */
  readonly message: string;
}

export type JsonSchemaValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly violations: readonly JsonSchemaViolation[] };

/** A frozen, reusable validator produced by {@link compileJsonSchema}. */
export interface CompiledJsonSchema {
  validate(value: unknown): JsonSchemaValidationResult;
}

export type JsonSchemaCompileResult =
  | { readonly ok: true; readonly schema: CompiledJsonSchema }
  | { readonly ok: false; readonly errors: readonly JsonSchemaDefinitionError[] };

/** Safety limits. Every field is a positive integer. */
export interface JsonSchemaLimits {
  /** Maximum nesting of sub-schemas. */
  readonly maxSchemaDepth: number;
  /** Maximum number of schema nodes (objects and booleans). */
  readonly maxSchemaNodes: number;
  /** Maximum number of `enum` values. */
  readonly maxEnumValues: number;
  /** Maximum `pattern` source length in UTF-16 code units. */
  readonly maxPatternLength: number;
  /** Maximum nesting of the validated value. */
  readonly maxValueDepth: number;
  /** Maximum number of nodes in the validated value. */
  readonly maxValueNodes: number;
  /** Longest string, in Unicode code points, that `pattern` is run against. */
  readonly maxPatternInputLength: number;
  /** Maximum violations reported before truncation. */
  readonly maxViolations: number;
}

export const DEFAULT_JSON_SCHEMA_LIMITS: JsonSchemaLimits = Object.freeze({
  maxSchemaDepth: 32,
  maxSchemaNodes: 1_000,
  maxEnumValues: 256,
  maxPatternLength: 256,
  maxValueDepth: 64,
  maxValueNodes: 100_000,
  maxPatternInputLength: 10_000,
  maxViolations: 100,
});
