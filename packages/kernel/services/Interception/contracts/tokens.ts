import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IInterceptionService } from './IInterceptionService.js';

export const InterceptionToken = createServiceToken<IInterceptionService>('brud.core.interception');
