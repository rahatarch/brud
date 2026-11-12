/** Stable, machine-readable identity registry failure codes. */
export type IdentityRegistryErrorCode =
  | 'IDENTITY_REGISTRY_MISSING'
  | 'IDENTITY_REGISTRY_CORRUPT'
  | 'IDENTITY_REGISTRY_FROZEN'
  | 'IDENTITY_REGISTRY_UNKNOWN_TOKEN'
  | 'IDENTITY_REGISTRY_REVOKED'
  | 'IDENTITY_REGISTRY_INPUT_INVALID'
  | 'IDENTITY_REGISTRY_NOT_READY'
  | 'IDENTITY_REGISTRY_STORAGE_EXISTS'
  | 'IDENTITY_REGISTRY_PATH_INVALID'
  | 'IDENTITY_REGISTRY_WRITE_FAILED';

/** Base class for every identity registry domain failure. */
export abstract class IdentityRegistryError extends Error {
  /** Stable, machine-readable failure code. */
  public abstract readonly code: IdentityRegistryErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = 'IdentityRegistryError';
  }
}

/**
 * Raised at boot when the configured registry storage file does not exist.
 *
 * The service refuses to regenerate a missing registry because a silent reset
 * would turn an integrity failure into an identity reset.
 */
export class IdentityRegistryMissingError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_MISSING' as const;

  /** Absolute storage path the service expected. */
  public readonly storagePath: string;

  constructor(storagePath: string) {
    super(
      `Identity registry storage is missing at "${storagePath}". Refusing to start the identity registry instead of regenerating it.`,
    );
    this.name = 'IdentityRegistryMissingError';
    this.storagePath = storagePath;
  }
}

/**
 * Raised at boot when the registry storage exists but fails parsing or
 * integrity validation.
 */
export class IdentityRegistryCorruptError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_CORRUPT' as const;

  /** Absolute storage path that failed validation. */
  public readonly storagePath: string;

  /** Scrubbed reason for the failure. Never includes raw storage content. */
  public readonly reason: string;

  constructor(storagePath: string, reason: string) {
    super(
      `Identity registry storage at "${storagePath}" failed integrity validation: ${reason}. Refusing to start the identity registry.`,
    );
    this.name = 'IdentityRegistryCorruptError';
    this.storagePath = storagePath;
    this.reason = reason;
  }
}

/** Raised when an operation attempts to mutate a frozen registry. */
export class IdentityRegistryFrozenError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_FROZEN' as const;

  /** Operation that was refused. */
  public readonly operation: string;

  constructor(operation: string) {
    super(
      `Cannot ${operation} an identity token: the identity registry froze when the kernel reached RUNNING.`,
    );
    this.name = 'IdentityRegistryFrozenError';
    this.operation = operation;
  }
}

/** Raised when an operation is attempted before the registry loaded. */
export class IdentityRegistryNotReadyError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_NOT_READY' as const;

  /** Operation that was refused. */
  public readonly operation: string;

  constructor(operation: string) {
    super(
      `Cannot ${operation} an identity token before the identity registry has loaded its storage.`,
    );
    this.name = 'IdentityRegistryNotReadyError';
    this.operation = operation;
  }
}

/** Raised when a retire or revoke names a token that is not recorded. */
export class IdentityRegistryUnknownTokenError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_UNKNOWN_TOKEN' as const;

  /** Token value that was not found. */
  public readonly token: string;

  constructor(token: string) {
    super(`Identity token "${token}" is not recorded in the identity registry.`);
    this.name = 'IdentityRegistryUnknownTokenError';
    this.token = token;
  }
}

/** Raised when a revoked token or binding is used again. */
export class IdentityRegistryRevokedError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_REVOKED' as const;

  /** Token whose binding is permanently revoked. */
  public readonly token: string;

  constructor(token: string) {
    super(
      `Identity token "${token}" is revoked permanently and can never be retired, reissued, or reactivated.`,
    );
    this.name = 'IdentityRegistryRevokedError';
    this.token = token;
  }
}

/** Raised when an operation receives an invalid opaque value. */
export class IdentityRegistryInputError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_INPUT_INVALID' as const;

  /** Field or operation that failed validation. */
  public readonly field: string;

  constructor(field: string, reason: string) {
    super(`Invalid identity registry input for ${field}: ${reason}`);
    this.name = 'IdentityRegistryInputError';
    this.field = field;
  }
}

/** Raised when a storage path is not an absolute file path. */
export class IdentityRegistryPathError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_PATH_INVALID' as const;

  /** Rejected path value. */
  public readonly storagePath: string;

  constructor(storagePath: string) {
    super(
      `Identity registry storage path must be an absolute file path; received "${storagePath}".`,
    );
    this.name = 'IdentityRegistryPathError';
    this.storagePath = storagePath;
  }
}

/** Raised when operator provisioning would overwrite an existing registry. */
export class IdentityRegistryStorageExistsError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_STORAGE_EXISTS' as const;

  /** Existing storage path. */
  public readonly storagePath: string;

  constructor(storagePath: string) {
    super(
      `Identity registry storage already exists at "${storagePath}"; provisioning never overwrites an existing registry.`,
    );
    this.name = 'IdentityRegistryStorageExistsError';
    this.storagePath = storagePath;
  }
}

/** Raised when the registry cannot write its storage file. */
export class IdentityRegistryWriteError extends IdentityRegistryError {
  public readonly code = 'IDENTITY_REGISTRY_WRITE_FAILED' as const;

  /** Storage path the write targeted. */
  public readonly storagePath: string;

  constructor(storagePath: string, reason: string) {
    super(`Identity registry write failed at "${storagePath}": ${reason}`);
    this.name = 'IdentityRegistryWriteError';
    this.storagePath = storagePath;
  }
}