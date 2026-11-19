/**
 * BrudTools' single dependency on a JSON Schema engine.
 *
 * The engine is the ValidationService package's library code (not a service
 * call). Every other file imports schema types and `compileJsonSchema` from
 * here, so when ValidationService is refactored this is the only line to move.
 */
export {
  compileJsonSchema,
  type JsonSchemaCompileResult,
  type JsonSchemaDefinitionError,
  type JsonSchemaViolation,
} from '../../ValidationService/engine/jsonSchema/index.js';
