import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IValidationService } from '../contracts/IValidationService.js';

/**
 * Kernel service token for `brud.core.validation`.
 *
 * Every caller may resolve this token. Validation only narrows what an
 * operation may do, so exposing it never widens authority; a plugin that
 * resolves it can check an input, but cannot relax a rule.
 */
export const ValidationToken = createServiceToken<IValidationService>(
  'brud.core.validation',
  'Frozen pre-execution validation gate for paths, commands and tool inputs',
);
