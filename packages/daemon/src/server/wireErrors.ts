import * as Protocol from '@brud/protocol';
import type { JsonRpcId, RpcErrorData, RpcErrorDetails, RpcErrorResponse } from '@brud/protocol';

type ErrorField = 'rule' | 'root' | 'path' | 'reason' | 'operation' | 'syscall';

const LIFECYCLE_ERROR_CODES: ReadonlySet<string> = new Set(['INVALID_LIFECYCLE_STATE']);

const ACCESS_ERROR_CODES: ReadonlySet<string> = new Set([
  'BLACKLISTED_ACCESS',
  'NOT_IN_ALLOWLIST',
]);

const STORAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  'EACCES',
  'EEXIST',
  'EISDIR',
  'EINVAL',
  'ENOTDIR',
  'EPERM',
]);

function readCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) {
    return undefined;
  }

  const code: unknown = error.code;
  return typeof code === 'string' ? code : undefined;
}

function readField(error: Error, field: ErrorField): string | undefined {
  switch (field) {
    case 'rule':
      return 'rule' in error && typeof error.rule === 'string' ? error.rule : undefined;
    case 'root':
      return 'root' in error && typeof error.root === 'string' ? error.root : undefined;
    case 'path':
      return 'path' in error && typeof error.path === 'string' ? error.path : undefined;
    case 'reason':
      return 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined;
    case 'operation':
      return 'operation' in error && typeof error.operation === 'string'
        ? error.operation
        : undefined;
    case 'syscall':
      return 'syscall' in error && typeof error.syscall === 'string'
        ? error.syscall
        : undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function genericErrorData(code: string | undefined): RpcErrorDetails {
  return code === undefined ? {} : { errorCode: code };
}

export function createRpcErrorResponse(
  id: JsonRpcId,
  code: Protocol.RpcErrorCode,
  message: string,
  data?: RpcErrorDetails,
): RpcErrorResponse {
  const error: RpcErrorData = data === undefined
    ? { code, message }
    : { code, message, data };

  return {
    jsonrpc: '2.0',
    id,
    error,
  };
}

export function toRpcErrorData(error: unknown): RpcErrorData {
  const code = readCode(error);
  const message = errorMessage(error);

  if (code === 'PATH_TRAVERSAL_DETECTED' && error instanceof Error) {
    return {
      code: Protocol.PATH_VIOLATION,
      message,
      data: {
        errorCode: code,
        rule: readField(error, 'rule'),
        root: readField(error, 'root'),
        path: readField(error, 'path'),
        reason: readField(error, 'reason'),
      },
    };
  }

  if (code === 'READ_ONLY_VIOLATION' && error instanceof Error) {
    return {
      code: Protocol.READ_ONLY_VIOLATION,
      message,
      data: {
        errorCode: code,
        operation: readField(error, 'operation'),
      },
    };
  }

  if (code !== undefined && LIFECYCLE_ERROR_CODES.has(code) && error instanceof Error) {
    return {
      code: Protocol.LIFECYCLE_STATE,
      message,
      data: {
        errorCode: code,
        operation: readField(error, 'operation'),
      },
    };
  }

  if (code !== undefined && ACCESS_ERROR_CODES.has(code)) {
    return {
      code: Protocol.ACCESS_DENIED,
      message,
      data: { errorCode: code },
    };
  }

  if (code === 'ENOENT') {
    return {
      code: Protocol.FILE_NOT_FOUND,
      message,
      data: { errorCode: code },
    };
  }

  if (code !== undefined && STORAGE_ERROR_CODES.has(code) && error instanceof Error) {
    return {
      code: Protocol.STORAGE_ERROR,
      message,
      data: {
        errorCode: code,
        syscall: readField(error, 'syscall'),
        path: readField(error, 'path'),
      },
    };
  }

  return {
    code: Protocol.INTERNAL_ERROR,
    message,
    data: genericErrorData(code),
  };
}

export function toRpcErrorResponse(id: JsonRpcId, error: unknown): RpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: toRpcErrorData(error),
  };
}
