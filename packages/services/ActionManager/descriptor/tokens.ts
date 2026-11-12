import { createServiceToken } from '@brud/kernel';
import type { IActionManager } from '../contracts/IActionManager.js';

/**
 * Kernel service token for `brud.core.actions`.
 *
 * Resolution grants UI-side catalog and dispatch authority. The token is
 * intentionally not reachable from a plugin context; only the plugin manager
 * (registration) and the UI daemon (list/execute) are allowlisted.
 */
export const ActionManagerToken = createServiceToken<IActionManager>(
  'brud.core.actions',
  'UI-only action registry and one-way dispatch table',
);