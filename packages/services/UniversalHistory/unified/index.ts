/**
 * Public surface of the unified polymorphic history engine (D-15).
 *
 * Exports are explicit: the store's `SessionRow` differs from the
 * contract-level `SessionRow` re-exported by `contracts/`, so the store and
 * service type modules are not re-exported wholesale.
 */
export {
  UNIFIED_HISTORY_DB_RELATIVE_PATH,
  createUnifiedHistoryDescriptors,
} from './descriptor/unifiedHistoryDescriptors.js';
export type { UnifiedHistoryDescriptorOptions } from './descriptor/unifiedHistoryDescriptors.js';
export {
  BUILTIN_ENTRY_TYPES,
  CORE_NAMESPACE,
  HISTORY_GC_GRACE_MS,
  FILE_ENTRY_TYPE,
  SESSION_TARGET_ENTRY_TYPE,
  UnifiedHistoryService,
  createReadOnlyNamespaceHandle,
  isCoreNamespace,
  isReservedNamespace,
} from './service/index.js';
export type {
  FileEntryPayload,
  HistoryRetentionReport,
  HistoryRetentionSettings,
  NamespaceHandleOptions,
  SessionDeleteReceipt,
  SessionLifecycleOptions,
  SessionTargetPayload,
  SessionTrashReceipt,
  TrashPurgeReceipt,
  TrashSessionOptions,
  UnifiedHistoryServiceOptions,
  WipeSessionsOptions,
  WipeSessionsReceipt,
} from './service/index.js';
export {
  DEFAULT_TRASH_RETENTION_MS,
  WIPE_CONFIRMATION_PHRASE,
} from './service/index.js';
export type {
  Disposable,
  EntryRecordInput,
  EntryReversal,
  EntryTypeRegistration,
  EntryView,
  NamespaceHistoryHandle,
  ReversalConflictReport,
  ReversalContext,
} from './service/types.js';
export * from './service/errors.js';
export { UnifiedHistoryStore } from './store/UnifiedHistoryStore.js';
export * from './store/errors.js';
export type {
  DeleteHistoryAction,
  DeleteHistoryPage,
  DeleteHistoryQuery,
  DeleteHistoryRow,
  DeleteHistoryStatus,
  EntryPage,
  EntryQuery,
  EntryRow,
  HistoryDegradedReason,
  RetentionPolicy,
  RetentionReport,
  ReversalMode,
} from './store/types.js';
export { ReversalEngine } from './engine/ReversalEngine.js';
export type {
  UnifiedOperationReversalPlan,
  UnifiedOperationReversalReceipt,
  UnifiedOperationSkip,
} from './engine/ReversalEngine.js';
export * from './engine/errors.js';
export { ForeignReversalPlanError, namespaceHistoryFor } from './adapters/PluginHistoryFacade.js';
