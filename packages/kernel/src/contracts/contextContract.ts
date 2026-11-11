/**
 * Dynamic context contract.
 *
 * Services declare the fields they need from the host-supplied options bag.
 * The core builds one schema from those declarations, enforces it at the boot
 * and runtime boundaries, and never names a concrete field itself.
 */

/** Primitive types the contract understands. */
export const CONTEXT_FIELD_TYPES = ['string', 'number', 'boolean', 'object'] as const;

/** A supported context field type. */
export type ContextFieldType = (typeof CONTEXT_FIELD_TYPES)[number];

/** One field a service requires or accepts from the options bag. */
export interface ContextFieldDeclaration {
  /** Dotted field name inside the declaring service's namespace. */
  readonly name: string;

  /** Primitive type the value must have. */
  readonly type: ContextFieldType;

  /** Whether the field must be present when a context is created. */
  readonly required: boolean;

  /** Short explanation of what the field is for. */
  readonly description: string;
}

/** One service's set of declarations for a single namespace. */
export interface ContextScopeDeclaration {
  /** Namespace owned by the declaring service. */
  readonly scope: string;

  /** Fields declared inside that namespace. */
  readonly fields: readonly ContextFieldDeclaration[];
}

/** A field after the kernel has accepted a declaration. */
export interface ContextFieldSchema extends ContextFieldDeclaration {
  /** Service that owns the namespace and declared the field. */
  readonly service: string;
}

/** The complete, introspectable contract for one kernel. */
export interface ContextSchema {
  /** Whether further declarations are rejected. */
  readonly locked: boolean;

  /** Accepted fields in declaration order. */
  readonly fields: readonly ContextFieldSchema[];
}

/** Stable failure code for every contract violation. */
export type ContextContractErrorCode = 'CONTEXT_CONTRACT_VIOLATION';

/** Raised when a declaration, a field name, or a value violates the contract. */
export class ContextContractError extends Error {
  public readonly code: ContextContractErrorCode = 'CONTEXT_CONTRACT_VIOLATION';

  /** Field involved in the violation, when one exists. */
  public readonly field: string | undefined;

  /** Namespace/service involved in the violation, when one exists. */
  public readonly service: string | undefined;

  /** Expected primitive type, when the violation is a type mismatch. */
  public readonly expectedType: ContextFieldType | undefined;

  /** Actual value type observed, when the violation is a type mismatch. */
  public readonly actualType: string | undefined;

  constructor(
    message: string,
    details: {
      readonly field?: string;
      readonly service?: string;
      readonly expectedType?: ContextFieldType;
      readonly actualType?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ContextContractError';
    this.field = details.field;
    this.service = details.service;
    this.expectedType = details.expectedType;
    this.actualType = details.actualType;
  }
}

interface StoredField extends ContextFieldSchema {
  readonly ownerId: string;
}

const SCOPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isContextFieldType(value: unknown): value is ContextFieldType {
  return typeof value === 'string'
    && (CONTEXT_FIELD_TYPES as readonly string[]).includes(value);
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

function matchesType(value: unknown, type: ContextFieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isRecord(value);
  }
}

function assertScope(scope: string): void {
  if (typeof scope !== 'string' || !SCOPE_PATTERN.test(scope)) {
    throw new ContextContractError(
      `Invalid context namespace "${String(scope)}". A namespace must start with a letter and contain only letters, digits, "_" or "-".`,
    );
  }
}

function assertFieldName(scope: string, name: string): void {
  if (typeof name !== 'string') {
    throw new ContextContractError(
      `A context field declared by namespace "${scope}" must have a string name.`,
      { service: scope },
    );
  }

  const segments = name.split('.');

  if (segments.length < 2 || segments.some((segment) => !SEGMENT_PATTERN.test(segment))) {
    throw new ContextContractError(
      `Field "${name}" declared by namespace "${scope}" must be a dotted path such as "${scope}.name".`,
      { field: name, service: scope },
    );
  }

  if (segments[0] !== scope) {
    throw new ContextContractError(
      `Namespace "${scope}" cannot declare field "${name}"; declarations must stay inside the "${scope}." namespace.`,
      { field: name, service: scope },
    );
  }
}

function assertDeclaration(scope: string, declaration: ContextFieldDeclaration): void {
  if (!isRecord(declaration)) {
    throw new ContextContractError(
      `Namespace "${scope}" supplied a context field declaration that is not an object.`,
      { service: scope },
    );
  }

  assertFieldName(scope, declaration.name);

  if (!isContextFieldType(declaration.type)) {
    throw new ContextContractError(
      `Field "${declaration.name}" declared by namespace "${scope}" has unsupported type "${String(declaration.type)}". Expected one of: ${CONTEXT_FIELD_TYPES.join(', ')}.`,
      { field: declaration.name, service: scope },
    );
  }

  if (typeof declaration.required !== 'boolean') {
    throw new ContextContractError(
      `Field "${declaration.name}" declared by namespace "${scope}" must set "required" to a boolean.`,
      { field: declaration.name, service: scope },
    );
  }

  if (typeof declaration.description !== 'string' || declaration.description.length === 0) {
    throw new ContextContractError(
      `Field "${declaration.name}" declared by namespace "${scope}" must include a non-empty description.`,
      { field: declaration.name, service: scope },
    );
  }
}

function normalizeDeclaration(
  scopeOrDeclaration: string | ContextScopeDeclaration,
  fields: readonly ContextFieldDeclaration[] | undefined,
): { readonly scope: string; readonly fields: readonly ContextFieldDeclaration[] } {
  if (typeof scopeOrDeclaration === 'string') {
    return { scope: scopeOrDeclaration, fields: fields ?? [] };
  }

  if (
    !isRecord(scopeOrDeclaration)
    || typeof scopeOrDeclaration.scope !== 'string'
    || !Array.isArray(scopeOrDeclaration.fields)
  ) {
    throw new ContextContractError(
      'A context contract declaration requires a scope string and a fields array.',
    );
  }

  return {
    scope: scopeOrDeclaration.scope,
    fields: scopeOrDeclaration.fields as readonly ContextFieldDeclaration[],
  };
}

/**
 * Per-kernel declaration store and validator.
 *
 * The class is generic: it understands dotted namespaces, primitive types, and
 * ownership, but no concrete field name.
 */
export class ContextContract {
  private readonly fields = new Map<string, StoredField>();

  private readonly owners = new Map<string, string>();

  private locked = false;

  /** `true` once the kernel has reached `RUNNING`. */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Records one service's declarations.
   *
   * @param ownerId - Stable identity of the declaring module.
   * @param scopeOrDeclaration - Namespace string or a complete scope declaration.
   * @param fields - Fields to declare when the second argument is a scope string.
   */
  declare(
    ownerId: string,
    scopeOrDeclaration: string | ContextScopeDeclaration,
    fields?: readonly ContextFieldDeclaration[],
  ): void {
    const { scope, fields: declarations } = normalizeDeclaration(scopeOrDeclaration, fields);

    assertScope(scope);

    if (this.locked) {
      throw new ContextContractError(
        `Context contract is locked; namespace "${scope}" cannot declare new fields after the kernel reached RUNNING.`,
        { service: scope },
      );
    }

    const owner = this.owners.get(scope);

    if (owner !== undefined && owner !== ownerId) {
      throw new ContextContractError(
        `Context namespace "${scope}" is already owned by another service; a namespace can only be declared by its owning service.`,
        { service: scope },
      );
    }

    if (owner === undefined) {
      this.owners.set(scope, ownerId);
    }

    for (const declaration of declarations) {
      assertDeclaration(scope, declaration);

      const existing = this.fields.get(declaration.name);

      if (existing !== undefined) {
        throw new ContextContractError(
          `Field "${declaration.name}" is already declared by namespace "${existing.service}".`,
          { field: declaration.name, service: scope },
        );
      }

      this.fields.set(declaration.name, {
        name: declaration.name,
        type: declaration.type,
        required: declaration.required,
        description: declaration.description,
        service: scope,
        ownerId,
      });
    }
  }

  /**
   * Validates an options bag against every accepted declaration.
   *
   * @param options - Host-supplied values carried through unchanged.
   * @throws {ContextContractError} When a required field is missing or a value
   * has the wrong type.
   */
  validate(options: Readonly<Record<string, unknown>>): void {
    for (const field of this.fields.values()) {
      const value = options[field.name];

      if (value === undefined) {
        if (field.required) {
          throw new ContextContractError(
            `Required context field "${field.name}" declared by service "${field.service}" is missing. Expected ${field.type}.`,
            {
              field: field.name,
              service: field.service,
              expectedType: field.type,
              actualType: 'missing',
            },
          );
        }

        continue;
      }

      if (!matchesType(value, field.type)) {
        throw new ContextContractError(
          `Context field "${field.name}" declared by service "${field.service}" must be of type ${field.type}; received ${describeValueType(value)}.`,
          {
            field: field.name,
            service: field.service,
            expectedType: field.type,
            actualType: describeValueType(value),
          },
        );
      }
    }
  }

  /** Prevents any further declaration. */
  lock(): void {
    this.locked = true;
  }

  /** Returns an immutable snapshot of the current schema. */
  schema(): ContextSchema {
    const fields = [...this.fields.values()].map((field) => Object.freeze({
      name: field.name,
      type: field.type,
      required: field.required,
      description: field.description,
      service: field.service,
    }));

    return Object.freeze({
      locked: this.locked,
      fields: Object.freeze(fields),
    });
  }
}