export type {
  BaselineSnapshot,
  BaselineTarget,
  CasBlobWrite,
  CommitReceipt,
  FileReversalAction,
  FileReversalActionKind,
  LedgerQueryFilter,
  OperationKind,
  PlanReversalOptions,
  ReversalConflict,
  ReversalConflictCode,
  ReversalPlan,
  ReversalReceipt,
  ReversalTargetState,
  SessionId,
  SessionManifest,
  SessionRow,
  SessionStatus,
  TargetDigest,
} from './IUniversalHistoryService/types.js';
export { SESSION_ID_PATTERN, isSessionId } from './IUniversalHistoryService/types.js';
export type {
  CommitOutcome,
  IUniversalHistoryService,
} from './IUniversalHistoryService/IUniversalHistoryService.js';

export type {
  IPluginHistoryService,
  PluginSessionRow,
  PluginSessionTarget,
  PluginSessionView,
  PluginTargetBaseline,
  RevertOperationsOptions,
} from './IPluginHistoryService.js';
export { isPluginHistoryService } from './IPluginHistoryService.js';

export type { IUniversalHistory } from './IUniversalHistory.js';
export type {
  Checkpoint,
  DetectedDrift,
  HistoryEntry,
  HistoryOperationKind,
  HistoryQueryFilter,
  RollbackReport,
  RollbackStatus,
} from './models.js';
