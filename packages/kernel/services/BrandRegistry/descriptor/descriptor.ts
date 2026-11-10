import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { IBrandRegistry } from '../contracts/IBrandRegistry.js';
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
 * Builds the brand registry descriptor.
 *
 * The registry has no dependencies: it must be constructible before any
 * service that wants to create a scope during boot.
 */
export function createBrandRegistryDescriptor(
  options?: BrandRegistryDescriptorOptions,
): ServiceDescriptor<IBrandRegistry, BrandRegistryService> {
  return {
    token: BrandRegistryToken,
    tier: BRAND_REGISTRY_SERVICE_TIER,
    dependencies: [],
    factory: (): BrandRegistryService => {
      const service = new BrandRegistryService();
      options?.onConstruct?.(service);

      return service;
    },
  };
}