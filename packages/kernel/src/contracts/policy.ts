import type { ServiceToken } from './serviceToken.js';

/**
 * Declarative access control rules applied when a caller requests a service.
 *
 * A denied caller is always rejected. When `allowedCallers` is provided, only
 * the listed callers may access the service; otherwise access is open.
 */
export interface ServiceAccessPolicy {
  /** Callers that can never access the service. */
  readonly deniedCallers?: readonly (string | ServiceToken<unknown>)[];

  /** Callers explicitly permitted to access the service. */
  readonly allowedCallers?: readonly (string | ServiceToken<unknown>)[];
}

/**
 * Base class for every rejection produced by a service access policy.
 *
 * Callers should branch on this type when they only need to know that the
 * broker refused access; the concrete subclasses carry the finer reason.
 */
export abstract class AccessDeniedError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: string;

  /** Identifier of the caller that attempted access. */
  public readonly callerId: string;

  /** Identifier of the service that denied access. */
  public readonly targetServiceId: string;

  /**
   * @param message - Path-free, human-readable denial description.
   * @param callerId - Identifier of the caller that attempted access.
   * @param targetServiceId - Identifier of the service that denied access.
   */
  protected constructor(message: string, callerId: string, targetServiceId: string) {
    super(message);
    this.name = 'AccessDeniedError';
    this.callerId = callerId;
    this.targetServiceId = targetServiceId;
  }
}

/**
 * Raised when a caller matches the deny list of a service's access policy.
 */
export class BlacklistedAccessViolationError extends AccessDeniedError {
  /** Stable, machine-readable error code. */
  public readonly code = 'BLACKLISTED_ACCESS' as const;

  /** Explanation of why the caller was denied. */
  public readonly reason: string;

  /**
   * @param callerId - Identifier of the caller that attempted access.
   * @param targetServiceId - Identifier of the service that denied access.
   * @param reason - Explanation of why the caller was denied.
   */
  constructor(callerId: string, targetServiceId: string, reason: string) {
    super(
      `Caller "${callerId}" is blacklisted from service "${targetServiceId}": ${reason}`,
      callerId,
      targetServiceId,
    );
    this.name = 'BlacklistedAccessViolationError';
    this.reason = reason;
  }
}

/**
 * Raised when a caller is not present in a service's allow list.
 */
export class AllowlistViolationError extends AccessDeniedError {
  /** Stable, machine-readable error code. */
  public readonly code = 'NOT_IN_ALLOWLIST' as const;

  /**
   * @param callerId - Identifier of the caller that attempted access.
   * @param targetServiceId - Identifier of the service that denied access.
   */
  constructor(callerId: string, targetServiceId: string) {
    super(
      `Caller "${callerId}" is not in the allowlist for service "${targetServiceId}"`,
      callerId,
      targetServiceId,
    );
    this.name = 'AllowlistViolationError';
  }
}
