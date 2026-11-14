import type { IKernelAccessBroker } from './accessBroker.js';
import type { IServiceLifecycle, ServiceContext, ServiceTier } from './lifecycle.js';
import type { ParticipantManifest } from './manifest.js';
import type { ServiceAccessPolicy } from './policy.js';
import type { ServiceToken } from './serviceToken.js';

/**
 * Contract a service descriptor declares for its public interface.
 *
 * The declaration is descriptive: it names the version and the methods the
 * service promises. The kernel only compares it against hardcore requirements;
 * it does not interpret any method.
 */
export interface ServiceContractDeclaration {
  /** Contract version the service implements. */
  readonly version: string;

  /** Method names the service implements for this contract. */
  readonly methods: readonly string[];
}

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
   * Declared contract for the public service interface.
   *
   * Optional for ordinary services. The kernel's fixed hardcore list requires
   * a declared contract on the services it names.
   */
  readonly contract?: ServiceContractDeclaration;

  /**
   * Declarative manifest: what the participant requests and which exposures
   * it gives, with their scopes and policies.
   *
   * Data only. The kernel admits it at boot without invoking {@link factory}.
   */
  readonly manifest?: ParticipantManifest;

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
