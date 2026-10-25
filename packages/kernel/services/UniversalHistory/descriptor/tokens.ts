import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IUniversalHistory } from '../contracts/IUniversalHistory.js';
import type { IUniversalHistoryService } from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';

export const UniversalHistoryToken = createServiceToken<IUniversalHistoryService>(
  'brud.core.universalHistory',
  'High-integrity transactional history and reversal ledger service',
);

/**
 * Token for the journal-driven, checkpoint/undo history service.
 *
 * The legacy transaction-oriented ledger keeps `brud.core.universalHistory`
 * until the decommission phase; this token is the Phase 4 operation-level
 * audit surface consumed by the filesystem mutation journal.
 */
export const HistoryToken = createServiceToken<IUniversalHistory>(
  'brud.core.history',
  'Deterministic, reversible audit of workspace mutations',
);
