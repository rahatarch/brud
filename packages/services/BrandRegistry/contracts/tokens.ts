import { createServiceToken } from '@brud/kernel';
import type { IBrandRegistry } from './IBrandRegistry.js';

/** Kernel token for the universal brand registry service. */
export const BrandRegistryToken = createServiceToken<IBrandRegistry>(
  'brud.core.brandRegistry',
  'Universal unforgeable brand registry for service-owned sub-items',
);