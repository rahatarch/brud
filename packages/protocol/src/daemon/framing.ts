import type { RpcErrorData } from './errors.js';

export type JsonRpcVersion = '2.0';

export type JsonRpcId = string | number | null;

export interface RpcRequest<TParams = unknown> {
  readonly jsonrpc: JsonRpcVersion;
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: TParams;
}

export interface RpcNotification<TParams = unknown> {
  readonly jsonrpc: JsonRpcVersion;
  readonly method: string;
  readonly params?: TParams;
}

export interface RpcSuccessResponse<TResult = unknown> {
  readonly jsonrpc: JsonRpcVersion;
  readonly id: JsonRpcId;
  readonly result: TResult;
}

export interface RpcErrorResponse {
  readonly jsonrpc: JsonRpcVersion;
  readonly id: JsonRpcId;
  readonly error: RpcErrorData;
}

export type RpcResponse<TResult = unknown> =
  | RpcSuccessResponse<TResult>
  | RpcErrorResponse;

export type RpcMessage =
  | RpcRequest
  | RpcNotification
  | RpcSuccessResponse
  | RpcErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

export function isRpcErrorData(value: unknown): value is RpcErrorData {
  return isRecord(value)
    && typeof value.code === 'number'
    && Number.isInteger(value.code)
    && typeof value.message === 'string';
}

export function isRpcRequest(value: unknown): value is RpcRequest {
  return isRecord(value)
    && value.jsonrpc === '2.0'
    && typeof value.method === 'string'
    && 'id' in value
    && isJsonRpcId(value.id);
}

export function isRpcNotification(value: unknown): value is RpcNotification {
  return isRecord(value)
    && value.jsonrpc === '2.0'
    && typeof value.method === 'string'
    && !('id' in value);
}

export function isRpcSuccessResponse(value: unknown): value is RpcSuccessResponse {
  return isRecord(value)
    && value.jsonrpc === '2.0'
    && 'id' in value
    && isJsonRpcId(value.id)
    && 'result' in value
    && !('error' in value);
}

export function isRpcErrorResponse(value: unknown): value is RpcErrorResponse {
  return isRecord(value)
    && value.jsonrpc === '2.0'
    && 'id' in value
    && isJsonRpcId(value.id)
    && 'error' in value
    && isRpcErrorData(value.error);
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  return isRpcSuccessResponse(value) || isRpcErrorResponse(value);
}

export function isRpcMessage(value: unknown): value is RpcMessage {
  return isRpcRequest(value) || isRpcNotification(value) || isRpcResponse(value);
}
