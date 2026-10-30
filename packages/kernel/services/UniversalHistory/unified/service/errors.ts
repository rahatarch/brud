/** Errors raised by the unified history service (D-15, U-3). */
import type { JsonSchemaDefinitionError, JsonSchemaViolation } from '../../../ValidationService/engine/jsonSchema/index.js';

/** A payload does not satisfy its registered schema. */
export class UnifiedEntryValidationError extends Error {
  public readonly code = 'HISTORY_ENTRY_INVALID' as const;

  constructor(public readonly entryType: string, public readonly violations: readonly JsonSchemaViolation[]) {
    super(`History entry ${entryType} does not match its registered schema (${violations.length} violation(s))`);
    this.name = 'UnifiedEntryValidationError';
  }
}

/** A registration's schema is not a valid schema in the supported subset. */
export class UnifiedEntrySchemaError extends Error {
  public readonly code = 'HISTORY_SCHEMA_INVALID' as const;

  constructor(public readonly entryType: string, public readonly errors: readonly JsonSchemaDefinitionError[]) {
    super(`Payload schema for ${entryType} is invalid (${errors.length} error(s))`);
    this.name = 'UnifiedEntrySchemaError';
  }
}

/** The entry type was never registered. */
export class UnifiedEntryTypeNotRegisteredError extends Error {
  public readonly code = 'HISTORY_TYPE_NOT_REGISTERED' as const;

  constructor(public readonly entryType: string) {
    super(`History entry type ${entryType} is not registered`);
    this.name = 'UnifiedEntryTypeNotRegisteredError';
  }
}

/** A namespace is reserved, malformed, or not owned by the caller. */
export class UnifiedNamespaceError extends Error {
  public readonly code = 'HISTORY_NAMESPACE_DENIED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnifiedNamespaceError';
  }
}

/** The session exists but is not in a state that allows the operation. */
export class UnifiedSessionStateError extends Error {
  public readonly code = 'HISTORY_SESSION_STATE' as const;

  constructor(public readonly sessionId: string, public readonly status: string, operation: string) {
    super(`Cannot ${operation} session ${sessionId} (status: ${status})`);
    this.name = 'UnifiedSessionStateError';
  }
}

/** A declared target path is not a safe workspace-relative path. */
export class UnifiedInvalidTargetPathError extends Error {
  public readonly code = 'HISTORY_INVALID_TARGET' as const;

  constructor(public readonly target: string) {
    super('Declared targets must be non-empty, workspace-relative paths without traversal');
    this.name = 'UnifiedInvalidTargetPathError';
  }
}
