import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IUniversalHistoryService } from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';

export const UniversalHistoryToken = createServiceToken<IUniversalHistoryService>(
  'brud.core.universalHistory',
  'High-integrity transactional history and reversal ledger service',
);
