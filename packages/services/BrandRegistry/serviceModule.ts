import type { KernelServiceModuleContext } from '@brud/kernel';
import type { IBrandRegistry } from './contracts/IBrandRegistry.js';
import { createBrandRegistryDescriptor } from './descriptor/descriptor.js';

/** Shared-bag slot where the brand registry publishes its instance. */
export const BRAND_REGISTRY_SLOT = 'brud.core.brandRegistry.instance';

export function createService(context: KernelServiceModuleContext) {
  return createBrandRegistryDescriptor({
    onConstruct: (service) => {
      context.shared[BRAND_REGISTRY_SLOT] = service;
    },
  });
}

/**
 * Reads the brand registry instance published during service construction.
 *
 * Service modules call this from a descriptor factory, while the kernel is
 * still booting, so scopes can be created inside the registration window.
 */
export function requireBrandRegistry(
  context: KernelServiceModuleContext,
): IBrandRegistry {
  const registry = context.shared[BRAND_REGISTRY_SLOT] as IBrandRegistry | undefined;

  if (registry === undefined) {
    throw new Error(
      'brud.core.brandRegistry must be constructed before any service creates a brand scope',
    );
  }

  return registry;
}