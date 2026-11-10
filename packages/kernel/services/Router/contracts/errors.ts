/** Stable, machine-readable codes for Router failures. */
export type RouterErrorCode =
  | 'ROUTER_REGISTRATION_CLOSED'
  | 'ROUTER_KIND_COLLISION'
  | 'ROUTER_INVALID_KIND'
  | 'ROUTER_UNKNOWN_SERVICE'
  | 'ROUTER_DISPOSED';

/** Base class for every Router domain failure. */
export abstract class RouterError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: RouterErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RouterError';
  }
}

/** Raised when a kind is claimed after the boot registration window closed. */
export class RouterRegistrationClosedError extends RouterError {
  public readonly code = 'ROUTER_REGISTRATION_CLOSED' as const;

  /** Kind the late registrant attempted to claim. */
  public readonly kind: string;

  /**
   * @param kind - Kind the late registrant attempted to claim.
   */
  constructor(kind: string) {
    super(`Router registration window is closed; kind "${kind}" was rejected`);
    this.name = 'RouterRegistrationClosedError';
    this.kind = kind;
  }
}

/** Raised when two services claim the same kind. */
export class RouterKindCollisionError extends RouterError {
  public readonly code = 'ROUTER_KIND_COLLISION' as const;

  /** Contested kind. */
  public readonly kind: string;

  /** Token id that already owns the kind. */
  public readonly existingTokenId: string;

  /**
   * @param kind - Contested kind.
   * @param existingTokenId - Token id that already owns the kind.
   */
  constructor(kind: string, existingTokenId: string) {
    super(`Kind "${kind}" is already claimed by service "${existingTokenId}"`);
    this.name = 'RouterKindCollisionError';
    this.kind = kind;
    this.existingTokenId = existingTokenId;
  }
}

/** Raised when a registrant supplies a malformed kind token. */
export class RouterInvalidKindError extends RouterError {
  public readonly code = 'ROUTER_INVALID_KIND' as const;

  /** Rejected value. */
  public readonly kind: string;

  /**
   * @param kind - Rejected value.
   */
  constructor(kind: string) {
    super(`Invalid operation kind "${kind}"`);
    this.name = 'RouterInvalidKindError';
    this.kind = kind;
  }
}

/** Raised when a registrant names a service the kernel does not own. */
export class RouterUnknownServiceError extends RouterError {
  public readonly code = 'ROUTER_UNKNOWN_SERVICE' as const;

  /** Token id that could not be resolved. */
  public readonly tokenId: string;

  /**
   * @param tokenId - Token id that could not be resolved.
   */
  constructor(tokenId: string) {
    super(`Router cannot register a kind for unregistered service "${tokenId}"`);
    this.name = 'RouterUnknownServiceError';
    this.tokenId = tokenId;
  }
}

/** Raised when routing is attempted after disposal. */
export class RouterDisposedError extends RouterError {
  public readonly code = 'ROUTER_DISPOSED' as const;

  constructor() {
    super('Brud router has been disposed');
    this.name = 'RouterDisposedError';
  }
}