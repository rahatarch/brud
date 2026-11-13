import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';

/**
 * Kernel service token for `brud.core.exposedApiRegistry`.
 *
 * Resolution grants read access to declared projections. Registration is a
 * boot-only capability and is unavailable through this token after the window
 * closes.
 */
export const ExposedApiRegistryToken = createServiceToken<IExposedApiRegistry>(
  'brud.core.exposedApiRegistry',
  'Boot-registered store of service-declared exposed APIs and projections',
);