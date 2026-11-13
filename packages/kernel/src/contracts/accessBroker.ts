import type { ServiceContext, ServiceTier } from './lifecycle.js';
import type { ServiceToken } from './serviceToken.js';

/**
 * Read-only metadata describing a registered service.
 */
export interface ServiceInfo {
  /** Stable identifier of the service. */
  readonly id: string;

  /** Short explanation of what the service provides. */
  readonly description: string;

  /** Privilege tier the service belongs to. */
  readonly tier: ServiceTier;

  /** Whether the service has completed initialization. */
  readonly initialized: boolean;
}

/**
 * Mediated entry point for resolving services across the microkernel boundary.
 *
 * Every resolution is subject to the target service's access policy and the
 * caller's {@link ServiceContext}.
 */
export interface IKernelAccessBroker {
  /**
   * Resolves a service for the given caller.
   *
   * @typeParam TService - The public interface carried by `token`.
   * @param caller - Context identifying the requesting caller.
   * @param token - Token identifying the requested service.
   * @returns The caller-facing view of the service.
   */
  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService;

  /**
   * Reports whether a service is registered.
   *
   * @param token - Token identifying the service.
   */
  hasService(token: ServiceToken<unknown>): boolean;

  /** Lists metadata for every registered service. */
  listServices(): readonly ServiceInfo[];

  /**
   * Suspends the lifecycle gate for a bounded boot-window operation.
   *
   * This is a general rule available to every participant on the same terms,
   * not a service-specific exception. It removes only the "broker is idle"
   * state check while the operation runs; every access policy, denial list,
   * and allowlist still applies, so a suspended gate never widens authority.
   * The kernel uses it around the boot pinner, where any module's
   * `pinBootPolicies` hook may ingest its boot snapshot before `RUNNING`.
   *
   * @param operation - Work performed while the gate is suspended.
   */
  withLifecycleGateSuspended?<T>(operation: () => Promise<T>): Promise<T>;
}
