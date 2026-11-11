import * as Protocol from '@brud/protocol';
import type { JsonRpcId, RpcErrorCode, RpcNotification, RpcRequest } from '@brud/protocol';
import { RECORD_NOTIFICATION, RECORD_REQUEST } from '../security/channel.js';
import type { RecordType } from '../security/channel.js';

const MAX_JSON_DEPTH = 64;

/** Why a raw record did not satisfy the closed message contract. */
export class JsonContractError extends Error {
  readonly frameId: JsonRpcId;

  constructor(message: string, frameId: JsonRpcId = null) {
    super(message);
    this.name = 'JsonContractError';
    this.frameId = frameId;
  }
}

/**
 * Extracts the best-effort request id from a malformed frame so the client can
 * correlate the parse error. The raw text is never trusted beyond this regex.
 */
export function extractFrameId(text: string): JsonRpcId {
  const match = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|null)/u.exec(text);

  if (match === null) {
    return null;
  }

  const raw = match[1] as string;

  if (raw === 'null') {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);

    return typeof value === 'string' || typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

/**
 * A strict JSON parser for the wire contract.
 *
 * `JSON.parse` silently keeps the last value of a duplicate key. This parser
 * rejects duplicate object keys, rejects trailing data, bounds nesting, and
 * builds ordinary objects without invoking the `__proto__` setter.
 */
export function parseStrictJson(text: string): unknown {
  let index = 0;

  const fail: (message: string) => never = (message: string): never => {
    throw new JsonContractError(`${message} at offset ${index}`, extractFrameId(text));
  };

  const skipWhitespace = (): void => {
    for (;;) {
      const code = text.charCodeAt(index);

      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        index += 1;
        continue;
      }

      return;
    }
  };

  const expect = (character: string): void => {
    if (text[index] !== character) {
      fail(`Expected "${character}"`);
    }

    index += 1;
  };

  const parseString = (): string => {
    if (text[index] !== '"') {
      fail('Expected a string');
    }

    const start = index;
    index += 1;

    for (;;) {
      if (index >= text.length) {
        fail('Unterminated string');
      }

      const character = text[index];

      if (character === '"') {
        index += 1;
        break;
      }

      if (character === '\\') {
        index += 2;
        continue;
      }

      index += 1;
    }

    const raw = text.slice(start, index);

    try {
      return JSON.parse(raw) as string;
    } catch {
      return fail('Invalid string escape');
    }
  };

  const parseNumber = (): number => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));

    if (match === null) {
      return fail('Invalid number');
    }

    index += match[0].length;

    return Number(match[0]);
  };

  const parseArray = (depth: number): unknown[] => {
    if (depth > MAX_JSON_DEPTH) {
      fail('JSON nesting limit exceeded');
    }

    const result: unknown[] = [];
    index += 1;
    skipWhitespace();

    if (text[index] === ']') {
      index += 1;
      return result;
    }

    for (;;) {
      result.push(parseValue(depth + 1));
      skipWhitespace();

      if (text[index] === ',') {
        index += 1;
        skipWhitespace();
        continue;
      }

      expect(']');
      return result;
    }
  };

  const parseObject = (depth: number): Record<string, unknown> => {
    if (depth > MAX_JSON_DEPTH) {
      fail('JSON nesting limit exceeded');
    }

    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    index += 1;
    skipWhitespace();

    if (text[index] === '}') {
      index += 1;
      return result;
    }

    for (;;) {
      const key = parseString();

      if (keys.has(key)) {
        fail(`Duplicate object key "${key}"`);
      }

      keys.add(key);
      skipWhitespace();
      expect(':');
      skipWhitespace();

      Object.defineProperty(result, key, {
        value: parseValue(depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });

      skipWhitespace();

      if (text[index] === ',') {
        index += 1;
        skipWhitespace();
        continue;
      }

      expect('}');
      return result;
    }
  };

  const parseLiteral = (literal: string, value: unknown): unknown => {
    if (text.slice(index, index + literal.length) !== literal) {
      fail(`Expected "${literal}"`);
    }

    index += literal.length;

    return value;
  };

  const parseValue = (depth: number): unknown => {
    skipWhitespace();

    const character = text[index];

    switch (character) {
      case '{':
        return parseObject(depth);
      case '[':
        return parseArray(depth);
      case '"':
        return parseString();
      case 't':
        return parseLiteral('true', true);
      case 'f':
        return parseLiteral('false', false);
      case 'n':
        return parseLiteral('null', null);
      default:
        if (character === '-' || (character !== undefined && character >= '0' && character <= '9')) {
          return parseNumber();
        }

        return fail('Unexpected token');
    }
  };

  const value = parseValue(0);
  skipWhitespace();

  if (index !== text.length) {
    fail('Trailing data after JSON value');
  }

  return value;
}

export interface IncomingRequest {
  readonly ok: true;
  readonly kind: 'request';
  readonly request: RpcRequest;
}

export interface IncomingNotification {
  readonly ok: true;
  readonly kind: 'notification';
  readonly notification: RpcNotification;
}

export interface IncomingFailure {
  readonly ok: false;
  readonly id: JsonRpcId;
  readonly code: RpcErrorCode;
  readonly message: string;
}

export type IncomingEnvelope = IncomingRequest | IncomingNotification | IncomingFailure;

const PARAMS_KEYS: Readonly<Record<string, readonly string[] | undefined>> = {
  [Protocol.DAEMON_CONNECT]: ['protocolVersion', 'clientInfo', 'client', 'capabilities'],
  [Protocol.DAEMON_PING]: ['nonce'],
  [Protocol.DAEMON_INFO]: [],
  [Protocol.WORKSPACE_LIST]: [],
  [Protocol.WORKSPACE_STATUS]: ['workspaceRoot'],
  [Protocol.WORKSPACE_DISPOSE]: ['workspaceRoot'],
  [Protocol.TOOLS_LIST]: [],
  [Protocol.TOOLS_EXECUTE]: ['name', 'input'],
  [Protocol.ACTIONS_LIST]: [],
  [Protocol.ACTIONS_EXECUTE]: ['name', 'input'],
  [Protocol.REQUEST_CANCEL]: ['id'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return `Unknown field "${key}"`;
    }
  }

  return undefined;
}

function validateParams(method: string, params: unknown): string | undefined {
  if (params === undefined) {
    return undefined;
  }

  if (!isRecord(params)) {
    return 'Method params must be a JSON object';
  }

  const allowed = PARAMS_KEYS[method];

  if (allowed !== undefined) {
    return rejectUnknownKeys(params, allowed);
  }

  return undefined;
}

/**
 * Validates one decrypted record against the closed JSON-RPC contract.
 *
 * The record type is the authenticated type carried in the AEAD associated
 * data. A request record may not contain a response, and a notification
 * record may not contain a request id.
 */
export function validateIncomingEnvelope(
  value: unknown,
  recordType: RecordType,
): IncomingEnvelope {
  if (!isRecord(value)) {
    return failure(null, Protocol.INVALID_REQUEST, 'Expected a JSON-RPC object');
  }

  const id = 'id' in value ? value.id : null;
  const safeId = isJsonRpcId(id) ? id : null;

  if (recordType === RECORD_REQUEST) {
    const unknown = rejectUnknownKeys(value, ['jsonrpc', 'id', 'method', 'params']);

    if (unknown !== undefined) {
      return failure(safeId, Protocol.INVALID_REQUEST, unknown);
    }

    if (value.jsonrpc !== '2.0') {
      return failure(safeId, Protocol.INVALID_REQUEST, 'jsonrpc must be "2.0"');
    }

    if (!('id' in value) || !isJsonRpcId(value.id)) {
      return failure(safeId, Protocol.INVALID_REQUEST, 'Request id must be a string, number, or null');
    }

    if (typeof value.method !== 'string' || value.method.length === 0) {
      return failure(safeId, Protocol.INVALID_REQUEST, 'method must be a non-empty string');
    }

    const paramsError = validateParams(value.method, value.params);

    if (paramsError !== undefined) {
      return failure(safeId, Protocol.INVALID_REQUEST, paramsError);
    }

    if (value.method === Protocol.DAEMON_CONNECT) {
      const params = value.params;

      if (!isRecord(params) || typeof params.protocolVersion !== 'string') {
        return failure(safeId, Protocol.INVALID_PARAMS, 'protocolVersion must be a string');
      }
    }

    return {
      ok: true,
      kind: 'request',
      request: {
        jsonrpc: '2.0',
        id: value.id,
        method: value.method,
        ...(value.params === undefined ? {} : { params: value.params }),
      },
    };
  }

  if (recordType === RECORD_NOTIFICATION) {
    const unknown = rejectUnknownKeys(value, ['jsonrpc', 'method', 'params']);

    if (unknown !== undefined) {
      return failure(safeId, Protocol.INVALID_REQUEST, unknown);
    }

    if (value.jsonrpc !== '2.0') {
      return failure(safeId, Protocol.INVALID_REQUEST, 'jsonrpc must be "2.0"');
    }

    if ('id' in value) {
      return failure(safeId, Protocol.INVALID_REQUEST, 'A notification must not carry an id');
    }

    if (typeof value.method !== 'string' || value.method.length === 0) {
      return failure(safeId, Protocol.INVALID_REQUEST, 'method must be a non-empty string');
    }

    if (value.method !== Protocol.REQUEST_CANCEL) {
      return failure(safeId, Protocol.INVALID_REQUEST, `Unknown notification "${value.method}"`);
    }

    const paramsError = validateParams(value.method, value.params);

    if (paramsError !== undefined) {
      return failure(safeId, Protocol.INVALID_REQUEST, paramsError);
    }

    return {
      ok: true,
      kind: 'notification',
      notification: {
        jsonrpc: '2.0',
        method: value.method,
        ...(value.params === undefined ? {} : { params: value.params }),
      },
    };
  }

  return failure(
    safeId,
    Protocol.INVALID_REQUEST,
    `The daemon does not accept ${recordType === 3 ? 'success' : 'error'} responses`,
  );
}

function failure(
  id: JsonRpcId,
  code: RpcErrorCode,
  message: string,
): IncomingFailure {
  return { ok: false, id, code, message };
}

/** True when a value is a plain object; retained for callers that need it. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}