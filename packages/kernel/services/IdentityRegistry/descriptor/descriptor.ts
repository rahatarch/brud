import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { requireContextString } from '../../../src/contracts/contextContract.js';
import type { IIdentityRegistry } from '../contracts/types.js';
import { IdentityRegistryService } from '../orchestrator/IdentityRegistryService.js';
import { IdentityRegistryToken } from './tokens.js';

/** Namespace owned by the identity registry in the context contract. */
export const IDENTITY_REGISTRY_CONTEXT_SCOPE = 'identity';

/** Namespaced context field holding the absolute registry storage file path. */
export const IDENTITY_REGISTRY_PATH_CONTEXT_FIELD = 'identity.registry.path';

/** Tier assigned to the identity registry descriptor. */
export const IDENTITY_REGISTRY_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createIdentityRegistryDescriptor}. */
export interface IdentityRegistryDescriptorOptions {
  /**
   * Absolute storage file path used instead of the context field.
   *
   * Intended for embedding the descriptor without a kernel context contract.
   * The standard composition reads `identity.registry.path`.
   */
  readonly storagePath?: string;

  /** Publishes the constructed instance for other service modules. */
  readonly onConstruct?: (service: IdentityRegistryService) => void;
}

/**
 * Builds the identity registry descriptor.
 *
 * The registry has no dependencies. It must be constructible before any
 * boot-time issuer that wants to record a binding, and the boot issuer depends
 * on {@link IdentityRegistryToken} so the registry's `initialize` runs first.
 *
 * @param options - Optional storage override and construction hook.
 */
export function createIdentityRegistryDescriptor(
  options?: IdentityRegistryDescriptorOptions,
): ServiceDescriptor<IIdentityRegistry, IdentityRegistryService> {
  return {
    token: IdentityRegistryToken,
    tier: IDENTITY_REGISTRY_SERVICE_TIER,
    dependencies: [],
    factory: (context): IdentityRegistryService => {
      const storagePath = options?.storagePath ?? requireContextString(
        context.options,
        IDENTITY_REGISTRY_PATH_CONTEXT_FIELD,
        IdentityRegistryToken.id,
      );
      const service = new IdentityRegistryService({ storagePath });
      options?.onConstruct?.(service);

      return service;
    },
  };
}