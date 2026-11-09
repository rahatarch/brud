import type {
  IPluginExecutionContext,
  IPluginHistoryService,
  OperationResult,
} from '@brud/kernel';
import {
  runListSessions,
  runRevertOperations,
  runRevertSession,
} from '../shared/operations.js';

export const REVERT_SESSION_TOOL = 'revert_session';
export const REVERT_OPERATIONS_TOOL = 'revert_operations';
export const LIST_SESSIONS_TOOL = 'list_sessions';

export const REVERT_SESSION_TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sessionId: {
      type: 'string',
      pattern: '^BR-\\d{8}-\\d{3,4}$',
      description: 'Session id to reverse, such as BR-20261109-001',
    },
    targetState: {
      type: 'string',
      enum: ['pre', 'post'],
      description: 'State to restore; defaults to pre',
    },
  },
  required: ['sessionId'],
  additionalProperties: false,
};

export const REVERT_OPERATIONS_TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sessionId: {
      type: 'string',
      pattern: '^BR-\\d{8}-\\d{3,4}$',
      description: 'Session that owns the operations',
    },
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
    targetState: {
      type: 'string',
      enum: ['pre', 'post'],
      description: 'State to restore; defaults to pre',
    },
  },
  required: ['sessionId', 'operationIds'],
  additionalProperties: false,
};

export const LIST_SESSIONS_TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    includeDeleted: {
      type: 'boolean',
      description: 'Include soft-deleted sessions',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 1000,
    },
    offset: {
      type: 'integer',
      minimum: 0,
    },
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

export function revertSession(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IPluginExecutionContext,
): Promise<OperationResult> {
  return runRevertSession(history, input);
}

export function revertOperations(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IPluginExecutionContext,
): Promise<OperationResult> {
  return runRevertOperations(history, input);
}

export function listSessions(
  input: Record<string, unknown>,
  history: IPluginHistoryService,
  _context?: IPluginExecutionContext,
): Promise<OperationResult> {
  return runListSessions(history, input);
}