import type {
  IActionExecutionContext,
  IPluginHistoryService,
  OperationResult,
} from '@brud/kernel';
import {
  WIPE_CONFIRMATION_PHRASE,
} from '../shared/historyResult.js';
import {
  runDeleteAuditLog,
  runGetSnapshots,
  runListAuditLog,
  runListSessions,
  runPermanentDelete,
  runRestoreSession,
  runRevertOperations,
  runRevertSession,
  runTrashSession,
  runWipeAll,
} from '../shared/operations.js';

export const HISTORY_REVERT_SESSION_ACTION = 'history.revert_session';
export const HISTORY_REVERT_OPERATIONS_ACTION = 'history.revert_operations';
export const HISTORY_LIST_SESSIONS_ACTION = 'history.list_sessions';
export const HISTORY_GET_SNAPSHOTS_ACTION = 'history.get_snapshots';
export const HISTORY_TRASH_SESSION_ACTION = 'history.trash_session';
export const HISTORY_RESTORE_SESSION_ACTION = 'history.restore_session';
export const HISTORY_PERMANENT_DELETE_ACTION = 'history.permanent_delete';
export const HISTORY_WIPE_ALL_ACTION = 'history.wipe_all';
export const HISTORY_REVERT_AUDIT_LOG_ACTION = 'history.revert_audit_log';
export const HISTORY_DELETE_AUDIT_LOG_ACTION = 'history.delete_audit_log';

const SESSION_ID_PROPERTY: Record<string, unknown> = {
  type: 'string',
  pattern: '^BR-\\d{8}-\\d{3,4}$',
  description: 'Session id, such as BR-20261109-001',
};

const TARGET_STATE_PROPERTY: Record<string, unknown> = {
  type: 'string',
  enum: ['pre', 'post'],
  description: 'State to restore; defaults to pre',
};

const ACTOR_PROPERTY: Record<string, unknown> = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
};

const REASON_PROPERTY: Record<string, unknown> = {
  type: 'string',
  maxLength: 2048,
};

const LIFECYCLE_PROPERTIES: Record<string, unknown> = {
  sessionId: SESSION_ID_PROPERTY,
  actor: ACTOR_PROPERTY,
  reason: REASON_PROPERTY,
};

const AUDIT_QUERY_PROPERTIES: Record<string, unknown> = {
  sessionId: { type: 'string' },
  action: {
    type: 'string',
    enum: ['trash', 'restore', 'delete', 'wipe', 'trash_expired'],
  },
  status: {
    type: 'string',
    enum: ['success', 'failed'],
  },
  since: {
    type: 'integer',
    minimum: 0,
    description: 'Inclusive lower bound on occurredAt, epoch milliseconds',
  },
  before: {
    type: 'integer',
    minimum: 0,
    description: 'Exclusive upper bound on occurredAt, epoch milliseconds',
  },
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: 1000,
  },
  after: {
    type: 'object',
    properties: {
      occurredAt: { type: 'integer', minimum: 0 },
      eventId: { type: 'string', minLength: 1 },
    },
    required: ['occurredAt', 'eventId'],
    additionalProperties: false,
  },
};

export const HISTORY_REVERT_SESSION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sessionId: SESSION_ID_PROPERTY,
    targetState: TARGET_STATE_PROPERTY,
  },
  required: ['sessionId'],
  additionalProperties: false,
};

export const HISTORY_REVERT_OPERATIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sessionId: SESSION_ID_PROPERTY,
    operationIds: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          { type: 'string', minLength: 1 },
          { type: 'integer' },
        ],
      },
      description: 'Entry ids or sequence numbers to reverse',
    },
    targetState: TARGET_STATE_PROPERTY,
  },
  required: ['sessionId', 'operationIds'],
  additionalProperties: false,
};

export const HISTORY_LIST_SESSIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    includeDeleted: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    offset: { type: 'integer', minimum: 0 },
    status: {
      type: 'string',
      enum: ['active', 'committed', 'aborted', 'reverted'],
    },
    since: {
      type: 'string',
      minLength: 1,
      description: 'Inclusive ISO-8601 lower bound on creation time',
    },
  },
  required: [],
  additionalProperties: false,
};

export const HISTORY_GET_SNAPSHOTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sessionId: SESSION_ID_PROPERTY,
  },
  required: ['sessionId'],
  additionalProperties: false,
};

export const HISTORY_TRASH_SESSION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: LIFECYCLE_PROPERTIES,
  required: ['sessionId'],
  additionalProperties: false,
};

export const HISTORY_RESTORE_SESSION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: LIFECYCLE_PROPERTIES,
  required: ['sessionId'],
  additionalProperties: false,
};

export const HISTORY_PERMANENT_DELETE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: LIFECYCLE_PROPERTIES,
  required: ['sessionId'],
  additionalProperties: false,
};

export const HISTORY_WIPE_ALL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    confirmation: {
      type: 'string',
      const: WIPE_CONFIRMATION_PHRASE,
      description: 'Exact phrase required by the kernel',
    },
    actor: ACTOR_PROPERTY,
    reason: REASON_PROPERTY,
  },
  required: ['confirmation'],
  additionalProperties: false,
};

export const HISTORY_REVERT_AUDIT_LOG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: AUDIT_QUERY_PROPERTIES,
  required: [],
  additionalProperties: false,
};

export const HISTORY_DELETE_AUDIT_LOG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: AUDIT_QUERY_PROPERTIES,
  required: [],
  additionalProperties: false,
};

export function historyRevertSession(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runRevertSession(history, input);
}

export function historyRevertOperations(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runRevertOperations(history, input);
}

export function historyListSessions(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runListSessions(history, input);
}

export function historyGetSnapshots(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runGetSnapshots(history, input);
}

export function historyTrashSession(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runTrashSession(history, input);
}

export function historyRestoreSession(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runRestoreSession(history, input);
}

export function historyPermanentDelete(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runPermanentDelete(history, input);
}

export function historyWipeAll(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runWipeAll(history, input);
}

export function historyRevertAuditLog(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runListAuditLog(history, input);
}

export function historyDeleteAuditLog(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IActionExecutionContext,
): Promise<OperationResult> {
  return runDeleteAuditLog(history, input);
}