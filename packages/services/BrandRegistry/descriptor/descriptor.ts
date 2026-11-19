import type { ServiceDescriptor, ServiceTier } from '@brud/kernel';
import { defineParticipant } from '@brud/sdk/participant';
import type { IBrandRegistry } from '../contracts/IBrandRegistry.js';
import { BRAND_REGISTRY_EXPOSURE, type IBrandRegistryApi } from '../contracts/exposure.js';
import { BrandRegistryToken } from '../contracts/tokens.js';
import { BrandRegistryService } from '../orchestrator/BrandRegistryService.js';

/** Tier assigned to the brand registry descriptor. */
export const BRAND_REGISTRY_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createBrandRegistryDescriptor}. */
export interface BrandRegistryDescriptorOptions {
  /** Publishes the constructed instance for other service modules. */
  readonly onConstruct?: (service: BrandRegistryService) => void;
}

/**
 * Builds the brand registry descriptor with the BrudOS SDK: one exposure,
 * `brud.brands@1`. The registry has no dependencies and resolves nothing, so
 * it is constructible before any service that creates a scope during boot.
 */
export function createBrandRegistryDescriptor(
  options?: BrandRegistryDescriptorOptions,
): ServiceDescriptor<IBrandRegistry, BrandRegistryService> {
  return defineParticipant<BrandRegistryService>({
    id: BrandRegistryToken.id,
    description: BrandRegistryToken.description,
    tier: BRAND_REGISTRY_SERVICE_TIER,
    exposes: {
      [BRAND_REGISTRY_EXPOSURE]: {
        version: 1,
        scope: 'runtime',
        handle: (_caller, ctx): IBrandRegistryApi => ctx.instance,
      },
    },
    create: () => {
      const service = new BrandRegistryService();
      options?.onConstruct?.(service);

      return service;
    },
  })() as unknown as ServiceDescriptor<IBrandRegistry, BrandRegistryService>;
}
