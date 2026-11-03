import {
  compileJsonSchema,
  type JsonSchemaCompileResult,
} from '../../ValidationService/engine/jsonSchema/index.js';

const compiled = new WeakMap<object, JsonSchemaCompileResult>();

/**
 * Compiles a registered `parametersSchema` once per frozen schema object.
 *
 * A compile failure is cached too, so a broken schema cannot be recompiled on
 * every dispatch. The caller decides how to report the failure; this function
 * never throws.
 *
 * @param schema - Registered JSON Schema object.
 * @returns The compile outcome.
 */
export function compiledSchemaFor(
  schema: Readonly<Record<string, unknown>>,
): JsonSchemaCompileResult {
  const cached = compiled.get(schema);

  if (cached !== undefined) {
    return cached;
  }

  const outcome = compileJsonSchema(schema);
  compiled.set(schema, outcome);

  return outcome;
}