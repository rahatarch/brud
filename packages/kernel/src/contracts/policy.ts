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
 * Raised when a caller matches the deny list of a service's access policy.
 */
export class BlacklistedAccessViolationError extends Error {
  /** Stable, machine-readable error code. */
  public readonly code = 'BLACKLISTED_ACCESS' as const;

  /** Identifier of the caller that attempted access. */
  public readonly callerId: string;

  /** Identifier of the service that denied access. */
  public readonly targetServiceId: string;

  /** Explanation of why the caller was denied. */
  public readonly reason: string;

  /**
   * @param callerId - Identifier of the caller that attempted access.
   * @param targetServiceId - Identifier of the service that denied access.
   * @param reason - Explanation of why the caller was denied.
   */
  constructor(callerId: string, targetServiceId: string, reason: string) {
    super(`Caller "${callerId}" is blacklisted from service "${targetServiceId}": ${reason}`);
    this.name = 'BlacklistedAccessViolationError';
    this.callerId = callerId;
    this.targetServiceId = targetServiceId;
    this.reason = reason;
  }
}

/**
 * Raised when a caller is not present in a service's allow list.
 */
export class AllowlistViolationError extends Error {
  /** Stable, machine-readable error code. */
  public readonly code = 'NOT_IN_ALLOWLIST' as const;

  /** Identifier of the caller that attempted access. */
  public readonly callerId: string;

  /** Identifier of the service that denied access. */
  public readonly targetServiceId: string;

  /**
   * @param callerId - Identifier of the caller that attempted access.
   * @param targetServiceId - Identifier of the service that denied access.
   */
  constructor(callerId: string, targetServiceId: string) {
    super(`Caller "${callerId}" is not in the allowlist for service "${targetServiceId}"`);
    this.name = 'AllowlistViolationError';
    this.callerId = callerId;
    this.targetServiceId = targetServiceId;
  }
}
