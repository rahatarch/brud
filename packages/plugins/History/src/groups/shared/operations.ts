import type { OperationResult } from '@brud/kernel';
import type { DeleteHistoryAction, DeleteHistoryQuery, DeleteHistoryStatus, IPluginHistoryService, LedgerQueryFilter, SessionLifecycleOptions, SessionStatus, TrashSessionOptions, WipeSessionsOptions } from '@brud/service-history';
import {
  WIPE_CONFIRMATION_PHRASE,
  SESSION_ID_PATTERN,
  historyFailure,
  historyFailureFromError,
  isRecord,
  readNonEmptyString,
} from './historyResult.js';

const SESSION_STATUSES: readonly SessionStatus[] = [
  'active',
  'committed',
  'aborted',
  'reverted',
];

const DELETE_HISTORY_ACTIONS: readonly DeleteHistoryAction[] = [
  'trash',
  'restore',
  'delete',
  'wipe',
  'trash_expired',
];

const DELETE_HISTORY_STATUSES: readonly DeleteHistoryStatus[] = ['success', 'failed'];

function sessionIdFrom(input: Record<string, unknown>): string | undefined {
  const sessionId = readNonEmptyString(input, 'sessionId');

  return sessionId !== undefined && SESSION_ID_PATTERN.test(sessionId)
    ? sessionId
    : undefined;
}

function targetStateFrom(input: Record<string, unknown>): 'pre' | 'post' {
  return input.targetState === 'post' ? 'post' : 'pre';
}

function operationIdsFrom(
  input: Record<string, unknown>,
): readonly (string | number)[] | undefined {
  const raw = input.operationIds;

  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }

  const ids: (string | number)[] = [];

  for (const value of raw) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
      return undefined;
    }

    ids.push(value);
  }

  return ids;
}

function actorReason(
  input: Record<string, unknown>,
): { readonly actor?: string; readonly reason?: string } {
  const actor = readNonEmptyString(input, 'actor');
  const reason = readNonEmptyString(input, 'reason');

  return {
    ...(actor === undefined ? {} : { actor }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function lifecycleOptions(input: Record<string, unknown>): SessionLifecycleOptions {
  return actorReason(input);
}

function trashOptions(input: Record<string, unknown>): TrashSessionOptions {
  return actorReason(input);
}

function wipeOptions(input: Record<string, unknown>): WipeSessionsOptions {
  return actorReason(input);
}

export function toLedgerFilter(input: Record<string, unknown>): LedgerQueryFilter {
  const status = input.status;
  const ledgerStatus =
    typeof status === 'string' && SESSION_STATUSES.some((value) => value === status)
      ? status as SessionStatus
      : undefined;

  return {
    ...(typeof input.includeDeleted === 'boolean'
      ? { includeDeleted: input.includeDeleted }
      : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
    ...(ledgerStatus === undefined ? {} : { status: ledgerStatus }),
    ...(typeof input.since === 'string' && input.since.length > 0
      ? { since: input.since }
      : {}),
  };
}

export function toAuditQuery(input: Record<string, unknown>): DeleteHistoryQuery {
  const action = input.action;
  const status = input.status;
  const after = input.after;

  const auditAction =
    typeof action === 'string' && DELETE_HISTORY_ACTIONS.some((value) => value === action)
      ? action as DeleteHistoryAction
      : undefined;

  const auditStatus =
    typeof status === 'string' && DELETE_HISTORY_STATUSES.some((value) => value === status)
      ? status as DeleteHistoryStatus
      : undefined;

  let afterCursor: DeleteHistoryQuery['after'];

  if (isRecord(after)
    && typeof after.occurredAt === 'number'
    && Number.isFinite(after.occurredAt)
    && typeof after.eventId === 'string'
    && after.eventId.length > 0) {
    afterCursor = { occurredAt: after.occurredAt, eventId: after.eventId };
  }

  return {
    ...(typeof input.sessionId === 'string' && input.sessionId.length > 0
      ? { sessionId: input.sessionId }
      : {}),
    ...(auditAction === undefined ? {} : { action: auditAction }),
    ...(auditStatus === undefined ? {} : { status: auditStatus }),
    ...(typeof input.since === 'number' ? { since: input.since } : {}),
    ...(typeof input.before === 'number' ? { before: input.before } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    ...(afterCursor === undefined ? {} : { after: afterCursor }),
  };
}

export async function runRevertSession(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const sessionId = sessionIdFrom(input);

  if (sessionId === undefined) {
    return historyFailure(
      'SESSION_ID_REQUIRED',
      'A canonical "sessionId" such as BR-20261109-001 is required.',
    );
  }

  const targetState = targetStateFrom(input);

  try {
    const plan = await history.planReversal(sessionId, { targetState });

    if (!plan.isExecutable) {
      return historyFailure(
        'REVERT_CONFLICT',
        `Session "${sessionId}" cannot be reverted to "${targetState}" because ${plan.conflicts.length} conflict(s) were found.`,
        { sessionId, targetState, conflicts: plan.conflicts },
      );
    }

    const receipt = await history.executeReversal(plan);

    return {
      status: 'success',
      message: `Reverted session "${sessionId}" to "${targetState}".`,
      data: receipt,
    };
  } catch (error) {
    return historyFailureFromError('REVERT_SESSION_FAILED', error);
  }
}

export async function runRevertOperations(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const sessionId = sessionIdFrom(input);

  if (sessionId === undefined) {
    return historyFailure(
      'SESSION_ID_REQUIRED',
      'A canonical "sessionId" such as BR-20261109-001 is required.',
    );
  }

  const operationIds = operationIdsFrom(input);

  if (operationIds === undefined) {
    return historyFailure(
      'OPERATION_IDS_REQUIRED',
      'A non-empty "operationIds" array of entry ids or sequence numbers is required.',
    );
  }

  const targetState = targetStateFrom(input);

  try {
    const receipt = await history.revertOperations(sessionId, operationIds, {
      targetState,
    });
    const partial = receipt.status === 'partial';

    return {
      status: partial ? 'failed' : 'success',
      message: partial
        ? `Partially reverted ${receipt.revertedEntries.length} operation(s) in session "${sessionId}"; ${receipt.skipped.length} were skipped.`
        : `Reverted ${receipt.revertedEntries.length} operation(s) in session "${sessionId}" to "${targetState}".`,
      data: receipt,
      ...(partial ? { error: 'REVERT_OPERATIONS_PARTIAL' } : {}),
    };
  } catch (error) {
    return historyFailureFromError('REVERT_OPERATIONS_FAILED', error);
  }
}

export async function runListSessions(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  try {
    const sessions = await history.listSessions(toLedgerFilter(input));

    return {
      status: 'success',
      message: `${sessions.length} session(s).`,
      data: { sessions, count: sessions.length },
    };
  } catch (error) {
    return historyFailureFromError('LIST_SESSIONS_FAILED', error);
  }
}

export async function runGetSnapshots(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const sessionId = sessionIdFrom(input);

  if (sessionId === undefined) {
    return historyFailure(
      'SESSION_ID_REQUIRED',
      'A canonical "sessionId" such as BR-20261109-001 is required.',
    );
  }

  try {
    const view = history.getSessionView(sessionId);

    if (view === undefined) {
      return historyFailure('SESSION_NOT_FOUND', `Session "${sessionId}" was not found.`);
    }

    return {
      status: 'success',
      message: `Snapshot for session "${sessionId}".`,
      data: {
        ...view,
        degraded: true,
        note: 'The kernel exposes one sanitized session view; there is no separate versioned snapshot list.',
      },
    };
  } catch (error) {
    return historyFailureFromError('GET_SNAPSHOTS_FAILED', error);
  }
}

export async function runTrashSession(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const sessionId = sessionIdFrom(input);

  if (sessionId === undefined) {
    return historyFailure(
      'SESSION_ID_REQUIRED',
      'A canonical "sessionId" such as BR-20261109-001 is required.',
    );
  }

  try {
    const receipt = history.trashSession(sessionId, trashOptions(input));

    return {
      status: 'success',
      message: `Moved session "${sessionId}" to the trash.`,
      data: receipt,
    };
  } catch (error) {
    return historyFailureFromError('TRASH_SESSION_FAILED', error);
  }
}

export async function runRestoreSession(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const sessionId = sessionIdFrom(input);

  if (sessionId === undefined) {
    return historyFailure(
      'SESSION_ID_REQUIRED',
      'A canonical "sessionId" such as BR-20261109-001 is required.',
    );
  }

  try {
    const receipt = history.restoreSession(sessionId, lifecycleOptions(input));

    return {
      status: 'success',
      message: `Restored session "${sessionId}" from the trash.`,
      data: receipt,
    };
  } catch (error) {
    return historyFailureFromError('RESTORE_SESSION_FAILED', error);
  }
}

export async function runPermanentDelete(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const sessionId = sessionIdFrom(input);

  if (sessionId === undefined) {
    return historyFailure(
      'SESSION_ID_REQUIRED',
      'A canonical "sessionId" such as BR-20261109-001 is required.',
    );
  }

  try {
    const receipt = history.deleteSessionPermanently(sessionId, lifecycleOptions(input));

    return {
      status: 'success',
      message: `Permanently deleted session "${sessionId}".`,
      data: receipt,
    };
  } catch (error) {
    return historyFailureFromError('PERMANENT_DELETE_FAILED', error);
  }
}

export async function runWipeAll(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  const confirmation = readNonEmptyString(input, 'confirmation');

  if (confirmation === undefined) {
    return historyFailure(
      'WIPE_CONFIRMATION_REQUIRED',
      `The exact confirmation phrase "${WIPE_CONFIRMATION_PHRASE}" is required.`,
    );
  }

  try {
    const receipt = await history.wipeAllSessions(confirmation, wipeOptions(input));

    return {
      status: 'success',
      message: `Permanently wiped ${receipt.deletedCount} session(s).`,
      data: receipt,
    };
  } catch (error) {
    return historyFailureFromError('WIPE_ALL_FAILED', error);
  }
}

export async function runListAuditLog(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  try {
    const page = history.listDeleteHistory(toAuditQuery(input));

    return {
      status: 'success',
      message: `${page.rows.length} audit event(s).`,
      data: page,
    };
  } catch (error) {
    return historyFailureFromError('LIST_AUDIT_LOG_FAILED', error);
  }
}

export async function runDeleteAuditLog(
  history: IPluginHistoryService,
  input: Record<string, unknown>,
): Promise<OperationResult> {
  try {
    const deleted = history.deleteAuditLog(toAuditQuery(input));

    return {
      status: 'success',
      message: `Deleted ${deleted} audit event(s).`,
      data: { deleted },
    };
  } catch (error) {
    return historyFailureFromError('DELETE_AUDIT_LOG_FAILED', error);
  }
}