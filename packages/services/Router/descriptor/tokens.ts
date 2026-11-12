import { createServiceToken } from '@brud/kernel';
import type { IRouterService } from '../contracts/IRouterService.js';

/**
 * Kernel service token for `brud.core.router`.
 *
 * Resolution grants the ability to parse and route a `[BRUD]` document to
 * registered Level-1 services. Registration is a boot-only capability and is
 * not reachable through this token after the window closes.
 */
export const RouterToken = createServiceToken<IRouterService>(
  'brud.core.router',
  'Boot-registered kind router dispatching parsed operations to Level-1 services',
);