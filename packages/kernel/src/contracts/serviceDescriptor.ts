import type { IKernelAccessBroker } from './accessBroker.js';
import type { IServiceLifecycle, ServiceContext, ServiceTier } from './lifecycle.js';
import type { ServiceAccessPolicy } from './policy.js';
import type { ServiceToken } from './serviceToken.js';

/**
 * Self-describing registration record for a kernel service.
 *
 * The factory may build a richer internal shape `TInternal`, while `project`
 * narrows that instance to the public `TService` interface for each caller.
 *
 * @typeParam TService - The public interface exposed to callers.
 * @typeParam TInternal - The internal instance type, which must extend `TService`.
 */
export interface ServiceDescriptor<TService, TInternal extends TService = TService> {
  /** Token identifying the service. */
  readonly token: ServiceToken<TService>;

  /** Privilege tier the service belongs to. */
  readonly tier: ServiceTier;

  /** Services that must be registered and initialized before this one. */
  readonly dependencies: readonly ServiceToken<unknown>[];

  /** Access control rules applied to every request. */
  readonly accessPolicy?: ServiceAccessPolicy;

  /**
   * Builds the service instance.
   *
   * @param context - Context of the service being constructed.
   * @param broker - Mediated access broker for dependency resolution.
   */
  readonly factory: (context: ServiceContext, broker: IKernelAccessBroker) => TInternal & IServiceLifecycle;

  /**
   * Projects the internal instance into the caller-facing interface.
   *
   * Defaults to returning the instance unchanged when omitted.
   *
   * @param instance - The internal service instance.
   * @param caller - Context of the requesting caller.
   */
  readonly project?: (instance: TInternal, caller: ServiceContext) => TService;
}
