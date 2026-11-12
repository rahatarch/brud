import type { CapabilityToken } from '@brud/kernel';
import type { ServiceToken } from '@brud/kernel';
import type {
  ExposedApiAccessContext,
  ExposedApiRegistration,
} from './types.js';

/**
 * Level-1 exposed API registry.
 *
 * The Registry is a dumb store: it maps `(apiName, token, capability,
 * projection)` and resolves matching projections through the access broker. It
 * has no knowledge of what a capability implies or what a projection does. All
 * of that lives in the declaring service.
 */
export interface IExposedApiRegistry {
  /**
   * Declares an exposed API for a registered service.
   *
   * The same service may add multiple capability entries for one API name.
   * A different service claiming the same name is a collision.
   *
   * @param name - Stable API name.
   * @param token - Service token resolved at dispatch time.
   * @param registration - Capability, projection, and optional combiner.
   */
  registerApi<TService>(
    name: string,
    token: ServiceToken<TService>,
    registration: ExposedApiRegistration,
  ): void;

  /**
   * Resolves the projections a caller may reach for one API.
   *
   * @param name - API name.
   * @param callerCapabilities - Capabilities the caller declared.
   * @param access - Broker identity and optional official/partition context.
   * @returns The projection, a combined projection, or `null`.
   */
  resolve<T = unknown>(
    name: string,
    callerCapabilities: Iterable<CapabilityToken>,
    access?: ExposedApiAccessContext,
  ): T | null;

  /** Seals the boot registration window. Idempotent. */
  closeRegistration(): void;

  /** Whether new exposures may still be registered. */
  isRegistrationOpen(): boolean;

  /** Registered API names in first-registration order. */
  registeredApiNames(): readonly string[];
}