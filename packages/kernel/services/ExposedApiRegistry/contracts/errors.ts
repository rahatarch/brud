/** Stable, machine-readable codes for Registry failures. */
export type ExposedApiErrorCode =
  | 'EXPOSED_API_REGISTRATION_CLOSED'
  | 'EXPOSED_API_NAME_COLLISION'
  | 'EXPOSED_API_INVALID_NAME'
  | 'EXPOSED_API_INVALID_CAPABILITY'
  | 'EXPOSED_API_INVALID_VERSION'
  | 'EXPOSED_API_INVALID_SCOPE'
  | 'EXPOSED_API_INVALID_POLICY'
  | 'EXPOSED_API_SCOPE_NARROWED'
  | 'EXPOSED_API_SCOPE_RECORD_CORRUPT'
  | 'EXPOSED_API_SCOPE_RECORD_PATH'
  | 'EXPOSED_API_SCOPE_RECORD_WRITE'
  | 'EXPOSED_API_UNKNOWN_SERVICE'
  | 'EXPOSED_API_DUPLICATE_CAPABILITY'
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

/** Raised when two services claim the same API name. */
export class ExposedApiNameCollisionError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_NAME_COLLISION' as const;

  /** Contested API name. */
  public readonly apiName: string;

  /** Token id that already owns the name. */
  public readonly existingTokenId: string;

  constructor(apiName: string, existingTokenId: string) {
    super(`Exposed API "${apiName}" is already owned by service "${existingTokenId}"`);
    this.name = 'ExposedApiNameCollisionError';
    this.apiName = apiName;
    this.existingTokenId = existingTokenId;
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

/** Raised when a registration capability is malformed. */
export class ExposedApiInvalidCapabilityError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_INVALID_CAPABILITY' as const;

  /** Rejected capability. */
  public readonly capability: string;

  constructor(capability: string) {
    super(`Invalid exposure capability "${capability}"`);
    this.name = 'ExposedApiInvalidCapabilityError';
    this.capability = capability;
  }
}

/** Raised when a registration names a service the kernel does not own. */
export class ExposedApiUnknownServiceError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_UNKNOWN_SERVICE' as const;

  /** Token id that could not be resolved. */
  public readonly tokenId: string;

  constructor(tokenId: string) {
    super(`Cannot expose an API for unregistered service "${tokenId}"`);
    this.name = 'ExposedApiUnknownServiceError';
    this.tokenId = tokenId;
  }
}

/** Raised when one service registers the same name/capability twice. */
export class ExposedApiDuplicateCapabilityError extends ExposedApiError {
  public readonly code = 'EXPOSED_API_DUPLICATE_CAPABILITY' as const;

  /** API name. */
  public readonly apiName: string;

  /** Duplicate capability. */
  public readonly capability: string;

  constructor(apiName: string, capability: string) {
    super(`Exposed API "${apiName}" already has an entry for capability "${capability}"`);
    this.name = 'ExposedApiDuplicateCapabilityError';
    this.apiName = apiName;
    this.capability = capability;
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