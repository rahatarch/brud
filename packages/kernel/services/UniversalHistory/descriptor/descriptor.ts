/**
 * Canonical entry point for the Phase 4 `brud.core.history` descriptor.
 *
 * The implementation lives in {@link ./HistoryDescriptor.ts} so the legacy
 * `brud.core.universalHistory` descriptor can keep its own module and token.
 */
export {
  HISTORY_BLOB_DIR_RELATIVE_PATH,
  HISTORY_CALLER_ID,
  HISTORY_DB_RELATIVE_PATH,
  HISTORY_SERVICE_TIER,
  createHistoryDescriptor,
} from './HistoryDescriptor.js';
export type { HistoryDescriptorOptions } from './HistoryDescriptor.js';
export { HistoryToken } from './tokens.js';
