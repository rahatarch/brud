/** Stable, machine-readable codes for Registry failures. */
export type ExposedApiErrorCode =
  | 'EXPOSED_API_REGISTRATION_CLOSED'
  | 'EXPOSED_API_NAME_COLLISION'
  | 'EXPOSED_API_INVALID_NAME'
  | 'EXPOSED_API_OWNER_PIN'
  | 'EXPOSED_API_DUPLICATE_EXPOSURE'
  | 'EXPOSED_API_NOT_ATTACHED'
  | 'EXPOSED_API_UNAVAILABLE'
  | 'EXPOSED_API_INVALID_VERSION'
  | 'EXPOSED_API_INVALID_SCOPE'
  | 'EXPOSED_API_INVALID_POLICY'
  | 'EXPOSED_API_SCOPE_NARROWED'
  | 'EXPOSED_API_SCOPE_RECORD_CORRUPT'
  | 'EXPOSED_API_SCOPE_RECORD_PATH'
  | 'EXPOSED_API_SCOPE_RECORD_WRITE'
  | 'EXPOSED_API_DISPOSED';

/** Base class for every Registry domain failure. */
export abstract class ExposedApiError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: ExposedApiErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExposedApiError';
  }
}

/** Raised when an exposure is registered after the boot window closed. */
export class ExposedApiRegistrationClosedError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_REGISTRATION_CLOSED' as const;

  /** Rejected API name. */
  public readonly apiName: string;

  constructor(apiName: string) {
    super(`Exposed API registration window is closed; "${apiName}" was rejected`);
    this.name = 'ExposedApiRegistrationClosedError';
    this.apiName = apiName;
  }
}

/**
 * Raised when a second identity registers a name another identity owns.
 *
 * A name is owned by the identity that first registered it, across every major
 * version: a version upgrade keeps ownership.
 */
export class ExposedApiNameCollisionError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_NAME_COLLISION' as const;

  /** Contested API name. */
  public readonly apiName: string;

  /** Identity token that owns the name. */
  public readonly owner: string;

  constructor(apiName: string, owner: string) {
    super(`Exposed API "${apiName}" is already owned by another identity`);
    this.name = 'ExposedApiNameCollisionError';
    this.apiName = apiName;
    this.owner = owner;
  }
}

/** Raised when a registration contradicts the composition's owner pin. */
export class ExposedApiOwnerPinError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_OWNER_PIN' as const;

  /** Pinned API name. */
  public readonly apiName: string;

  constructor(apiName: string) {
    super(`Exposed API "${apiName}" is pinned to a different owner identity by the composition`);
    this.name = 'ExposedApiOwnerPinError';
    this.apiName = apiName;
  }
}

/** Raised when one identity declares the same name and major version twice. */
export class ExposedApiDuplicateExposureError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_DUPLICATE_EXPOSURE' as const;

  /** API name. */
  public readonly apiName: string;

  /** Duplicated major version. */
  public readonly major: number;

  constructor(apiName: string, major: number) {
    super(`Exposed API "${apiName}" major version ${String(major)} is declared twice`);
    this.name = 'ExposedApiDuplicateExposureError';
    this.apiName = apiName;
    this.major = major;
  }
}

/** Raised when admission runs before the kernel attached its call authority. */
export class ExposedApiNotAttachedError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_NOT_ATTACHED' as const;

  constructor() {
    super('Exposed API Registry has no kernel call authority attached');
    this.name = 'ExposedApiNotAttachedError';
  }
}

/**
 * Raised when an exposure handle is used by a caller the exposure's policy
 * does not permit at the time of use.
 *
 * Carries no reason. The detailed reason is on the kernel's observation
 * stream, so a refused caller learns nothing about why.
 */
export class ExposedApiUnavailableError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_UNAVAILABLE' as const;

  constructor() {
    super('Exposed API is unavailable');
    this.name = 'ExposedApiUnavailableError';
  }
}

/** Raised when an API name is malformed. */
export class ExposedApiInvalidNameError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_INVALID_NAME' as const;

  /** Rejected name. */
  public readonly apiName: string;

  constructor(apiName: string) {
    super(`Invalid exposed API name "${apiName}"`);
    this.name = 'ExposedApiInvalidNameError';
    this.apiName = apiName;
  }
}

/** Raised when the Registry is used after disposal. */
export class ExposedApiDisposedError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_DISPOSED' as const;

  constructor() {
    super('Exposed API Registry has been disposed');
    this.name = 'ExposedApiDisposedError';
  }
}

/** Raised when a registration declares an invalid API version. */
export class ExposedApiInvalidVersionError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_INVALID_VERSION' as const;

  /** Rejected version. */
  public readonly version: unknown;

  constructor(version: unknown) {
    super(`Invalid exposed API version "${String(version)}"`);
    this.name = 'ExposedApiInvalidVersionError';
    this.version = version;
  }
}

/** Raised when a registration declares an unsupported scope. */
export class ExposedApiInvalidScopeError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_INVALID_SCOPE' as const;

  /** Rejected scope. */
  public readonly scope: unknown;

  constructor(scope: unknown) {
    super(`Invalid exposed API scope "${String(scope)}"`);
    this.name = 'ExposedApiInvalidScopeError';
    this.scope = scope;
  }
}

/** Raised when a registration declares a malformed policy. */
export class ExposedApiInvalidPolicyError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_INVALID_POLICY' as const;

  /** Human-readable reason. */
  public readonly reason: string;

  constructor(reason: string) {
    super(`Invalid exposed API policy: ${reason}`);
    this.name = 'ExposedApiInvalidPolicyError';
    this.reason = reason;
  }
}

/** Raised when a registration narrows a persisted scope within one version. */
export class ExposedApiScopeNarrowingError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_SCOPE_NARROWED' as const;

  /** API name. */
  public readonly apiName: string;

  /** API version. */
  public readonly version: string;

  /** Scope already recorded for the identity. */
  public readonly persistedScope: string;

  /** Scope the registration requested. */
  public readonly requestedScope: string;

  constructor(
    apiName: string,
    version: string,
    persistedScope: string,
    requestedScope: string,
  ) {
    super(
      `Exposed API "${apiName}" version "${version}" cannot narrow its scope from "${persistedScope}" to "${requestedScope}"`,
    );
    this.name = 'ExposedApiScopeNarrowingError';
    this.apiName = apiName;
    this.version = version;
    this.persistedScope = persistedScope;
    this.requestedScope = requestedScope;
  }
}

/** Raised when the protected scope record cannot be parsed or verified. */
export class ExposedApiScopeRecordCorruptError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_SCOPE_RECORD_CORRUPT' as const;

  /** Absolute storage path. */
  public readonly storagePath: string;

  /** Human-readable reason. */
  public readonly reason: string;

  constructor(storagePath: string, reason: string) {
    super(`Exposed API scope record "${storagePath}" is corrupt: ${reason}`);
    this.name = 'ExposedApiScopeRecordCorruptError';
    this.storagePath = storagePath;
    this.reason = reason;
  }
}

/** Raised when a scope-record storage path is not an absolute file path. */
export class ExposedApiScopeRecordPathError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_SCOPE_RECORD_PATH' as const;

  /** Rejected path. */
  public readonly storagePath: string;

  constructor(storagePath: string) {
    super(`Invalid exposed API scope record path "${storagePath}"`);
    this.name = 'ExposedApiScopeRecordPathError';
    this.storagePath = storagePath;
  }
}

/** Raised when the protected scope record cannot be written. */
export class ExposedApiScopeRecordWriteError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_SCOPE_RECORD_WRITE' as const;

  /** Absolute storage path. */
  public readonly storagePath: string;

  /** Filesystem error code, when available. */
  public readonly reason: string;

  constructor(storagePath: string, reason: string) {
    super(`Cannot write exposed API scope record "${storagePath}": ${reason}`);
    this.name = 'ExposedApiScopeRecordWriteError';
    this.storagePath = storagePath;
    this.reason = reason;
  }
}