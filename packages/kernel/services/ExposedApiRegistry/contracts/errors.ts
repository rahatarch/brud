/** Stable, machine-readable codes for Registry failures. */
export type ExposedApiErrorCode =
  | 'EXPOSED_API_REGISTRATION_CLOSED'
  | 'EXPOSED_API_NAME_COLLISION'
  | 'EXPOSED_API_INVALID_NAME'
  | 'EXPOSED_API_INVALID_CAPABILITY'
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