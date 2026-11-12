import { createServiceToken } from '@brud/kernel';
import type { IBrudParserService } from '../contracts/IParserService.js';

/**
 * Kernel service token for `brud.core.parser`.
 *
 * Resolution grants pure syntax parsing only. The parser holds no registry,
 * broker, or routing authority.
 */
export const ParserToken = createServiceToken<IBrudParserService>(
  'brud.core.parser',
  'Brud Protocol v2 syntax parser producing kind-tagged operations',
);