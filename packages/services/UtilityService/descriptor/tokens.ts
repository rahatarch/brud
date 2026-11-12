import { createServiceToken } from '@brud/kernel';
import type { IUtilityService } from '../contracts/IUtilityService.js';

/**
 * Kernel service token for `brud.core.utils`.
 *
 * The service hosts pure, stateless functions only (D-19/D-20). It declares no
 * dependencies and holds no ambient authority, so any caller may resolve it
 * without a plugin permission.
 */
export const UtilityToken = createServiceToken<IUtilityService>(
  'brud.core.utils',
  'Utility service hosting pure stateless functions',
);