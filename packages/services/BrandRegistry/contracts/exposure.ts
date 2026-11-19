import type { IBrandRegistry } from './IBrandRegistry.js';

/** Exposure name for the brand registry (`brud.brands@1`). */
export const BRAND_REGISTRY_EXPOSURE = 'brud.brands';

/** API served under {@link BRAND_REGISTRY_EXPOSURE}. */
export type IBrandRegistryApi = IBrandRegistry;
