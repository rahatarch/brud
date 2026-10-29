import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IBrudToolsService } from '../contracts/IBrudToolsService.js';

/**
 * Kernel service token for `brud.core.tools`.
 *
 * Resolution grants no execution authority beyond what the tool's own handler
 * and the schema gate allow: callers register and dispatch, and every payload
 * passes the validation gate first.
 */
export const BrudToolsToken = createServiceToken<IBrudToolsService>(
  'brud.core.tools',
  'Live tool registry, certification status, schema gate and dispatch table',
);
