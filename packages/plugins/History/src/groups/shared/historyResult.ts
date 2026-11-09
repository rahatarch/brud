import type { OperationResult } from '@brud/kernel';

export const WIPE_CONFIRMATION_PHRASE = 'DELETE ALL HISTORY';

export const SESSION_ID_PATTERN = /^BR-\d{8}-\d{3,4}$/;

export type HistoryFailureCode =
  | 'SESSION_ID_REQUIRED'
  | 'SESSION_NOT_FOUND'
  | 'OPERATION_IDS_REQUIRED'
  | 'REVERT_CONFLICT'
  | 'REVERT_OPERATIONS_PARTIAL'
  | 'REVERT_SESSION_FAILED'
  | 'REVERT_OPERATIONS_FAILED'
  | 'LIST_SESSIONS_FAILED'
  | 'GET_SNAPSHOTS_FAILED'
  | 'TRASH_SESSION_FAILED'
  | 'RESTORE_SESSION_FAILED'
  | 'PERMANENT_DELETE_FAILED'
  | 'WIPE_CONFIRMATION_REQUIRED'
  | 'WIPE_ALL_FAILED'
  | 'LIST_AUDIT_LOG_FAILED'
  | 'DELETE_AUDIT_LOG_FAILED';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readNonEmptyString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function kernelErrorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === 'string' && error.code.length > 0) {
    return error.code;
  }

  return undefined;
}

export function historyFailure(
  code: HistoryFailureCode,
  message: string,
  data?: unknown,
): OperationResult {
  return {
    status: 'failed',
    message: `${code}: ${message}`,
    error: code,
    ...(data === undefined ? {} : { data }),
  };
}

export function historyFailureFromError(
  code: HistoryFailureCode,
  error: unknown,
): OperationResult {
  const message = error instanceof Error ? error.message : String(error);
  const kernelCode = kernelErrorCode(error);

  return {
    status: 'failed',
    message: `${code}: ${message}`,
    error: kernelCode ?? code,
  };
}