import type { CapabilityToken } from '../../../src/contracts/capability.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import type {
  ExposedApiAccessContext,
  ExposedApiIdentity,
  ExposedApiRegistration,
  ExposedApiResolved,
  ExposedApiScope,
  ExposedApiVersion,
} from './types.js';

/**
 * Level-1 exposed API registry.
 *
 * The Registry is a dumb store: it maps a versioned API identity to
 * `(token, capability, projection)` entries and resolves matching projections
 * through the access broker. It checks the declared scope against the call
 * chain's root origin and returns the stored policy with the resolved handle.
 * It never interprets a capability, a projection, or a policy; those belong to
 * the declaring service and its giver.
 */
export interface IExposedApiRegistry {
  /**
   * Declares an exposed API for a registered service.
   *
   * The same service may add multiple capability entries for one identity.
   * A different service claiming the same `(name, version)` is a collision.
   * A different version is a different identity and may be claimed separately.
   *
   * @param name - Stable API name.
   * @param token - Service token resolved at dispatch time.
   * @param registration - Capability, version, scope, policy, projection, and
   * optional combiner.
   */
  registerApi<TService>(
    name: string,
    token: ServiceToken<TService>,
    registration: ExposedApiRegistration,
  ): void;

  /**
   * Resolves the projection a caller may reach for one API identity.
   *
   * @param name - API name.
   * @param callerCapabilities - Capabilities the caller declared.
   * @param access - Broker identity, official context, and root
   * origin.
   * @param version - API version; defaults to major version 1.
   * @returns The projection, a combined projection, or `null` when the origin
   * or capability is refused.
   */
  resolve<T = unknown>(
    name: string,
    callerCapabilities: Iterable<CapabilityToken>,
    access?: ExposedApiAccessContext,
    version?: ExposedApiVersion,
  ): T | null;

  /**
   * Resolves the projection together with its stored declaration.
   *
   * @param name - API name.
   * @param callerCapabilities - Capabilities the caller declared.
   * @param access - Broker identity, official context, and root
   * origin.
   * @param version - API version; defaults to major version 1.
   * @returns The resolved handle, scope, and policy, or `null`.
   */
  resolveWithMetadata<T = unknown>(
    name: string,
    callerCapabilities: Iterable<CapabilityToken>,
    access?: ExposedApiAccessContext,
    version?: ExposedApiVersion,
  ): ExposedApiResolved<T> | null;

  /** Returns the recorded scope for one identity, or `null` when unknown. */
  scopeOf(name: string, version?: ExposedApiVersion): ExposedApiScope | null;

  /** Seals the boot registration window. Idempotent. */
  closeRegistration(): void;

  /** Whether new exposures may still be registered. */
  isRegistrationOpen(): boolean;

  /** Registered API names in first-registration order. */
  registeredApiNames(): readonly string[];

  /** Registered versioned identities in first-registration order. */
  registeredApiIdentities(): readonly ExposedApiIdentity[];
}