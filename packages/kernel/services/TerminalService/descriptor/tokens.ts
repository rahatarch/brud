import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { ITerminalService } from '../contracts/ITerminalService.js';

/**
 * Kernel service token for `brud.core.terminal`.
 *
 * Resolution does not widen authority beyond validation: the service
 * re-validates every command before it spawns, so a plugin that resolves the
 * token cannot execute anything the validation gate would refuse.
 */
export const TerminalToken = createServiceToken<ITerminalService>(
  'brud.core.terminal',
  'Frozen process lifecycle, streaming and execution authority for terminal commands',
);
