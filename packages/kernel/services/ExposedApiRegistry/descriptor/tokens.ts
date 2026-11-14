import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IExposedApiRegistry } from '../contracts/IExposedApiRegistry.js';

/**
 * Kernel service token of the resolution primitive.
 *
 * Every participant reaches `resolve` through this token. Registration is the
 * kernel's own, during admission, and is never reachable through it.
 */
export const ExposedApiRegistryToken = createServiceToken<IExposedApiRegistry>(
  'brud.core.exposedApiRegistry',
  'Resolution primitive for manifest-declared exposures',
);