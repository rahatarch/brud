import type { IMcpTransport, IPluginLogger } from '@brud/kernel';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';

/** Default ceiling for one inbound MCP message. Matches the HTTP body cap. */
export const MCP_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/** Construction options for {@link ImcpTransportBridge}. */
export interface ImcpTransportBridgeOptions {
  /** Maximum accepted payload size in bytes. Defaults to {@link MCP_MAX_PAYLOAD_BYTES}. */
  readonly maxPayloadBytes?: number;

  /** Diagnostic sink for rejected payloads and shutdown failures. */
  readonly logger?: Pick<IPluginLogger, 'warn'>;
}

interface PendingResponse {
  readonly id: RequestId;
  readonly resolve: (message: JSONRPCMessage) => void;
  readonly reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type IdentifiedMessage = JSONRPCMessage & { readonly id: RequestId };

function hasId(message: JSONRPCMessage): message is IdentifiedMessage {
  return 'id' in message && message.id !== undefined && message.id !== null;
}

function isResponse(message: JSONRPCMessage): boolean {
  return 'result' in message || 'error' in message;
}

function isRequest(
  message: JSONRPCMessage,
): message is IdentifiedMessage & { readonly method: string } {
  return 'method' in message && typeof message.method === 'string' && hasId(message);
}

function requestKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

function payloadByteLength(raw: unknown): number {
  if (typeof raw === 'string') {
    return Buffer.byteLength(raw, 'utf8');
  }

  try {
    return Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

function extractRequestId(raw: unknown): RequestId | null {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  if (!isRecord(value) || value.id === undefined || value.id === null) {
    return null;
  }

  return typeof value.id === 'string' || typeof value.id === 'number' ? value.id : null;
}

function parseMessage(raw: unknown): JSONRPCMessage {
  const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;

  if (!isRecord(value) || value.jsonrpc !== '2.0') {
    throw new Error('Invalid JSON-RPC message: expected a "2.0" envelope');
  }

  return value as unknown as JSONRPCMessage;
}

/**
 * Adapts the daemon's request/response {@link IMcpTransport} to the SDK
 * `Transport` interface.
 *
 * The daemon invokes `onMessage(handler)` once per decoded JSON-RPC message
 * and writes whatever the handler resolves to back to the caller. The SDK, by
 * contrast, delivers messages through a callback and emits responses through
 * `send()`. This adapter bridges the two shapes:
 *
 * - an incoming request creates a pending entry keyed by JSON-RPC id and is
 *   handed to the SDK's `onmessage`; the returned promise resolves when the
 *   SDK calls `send()` with the matching response;
 * - an incoming notification is handed to `onmessage` and resolves to
 *   `undefined`, telling the daemon that no response is expected;
 * - an outgoing notification (no matching pending request) is forwarded
 *   through {@link IMcpTransport.sendNotification}.
 *
 * Server-initiated requests are not used by the bridge; if the SDK ever emits
 * one it is forwarded as a notification rather than silently dropped.
 */
export class ImcpTransportBridge implements Transport {
  public onclose?: () => void;

  public onerror?: (error: Error) => void;

  public onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  private readonly pending = new Map<string, PendingResponse>();

  private started = false;

  constructor(
    private readonly transport: IMcpTransport,
    private readonly options: ImcpTransportBridgeOptions = {},
  ) {}

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.transport.onMessage((message) => this.handleIncoming(message));
  }

  public async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (isResponse(message) && hasId(message)) {
      const pending = this.pending.get(requestKey(message.id));

      if (pending !== undefined) {
        this.pending.delete(requestKey(message.id));
        pending.resolve(message);

        return;
      }
    }

    // Notifications, and any uncorrelated server message, use the daemon's
    // notification channel.
    this.transport.sendNotification(message);
  }

  public async close(): Promise<void> {
    // Resolve instead of reject: the daemon's transport awaits every handler
    // result, so a rejection during shutdown becomes an unhandled rejection
    // and terminates the process with a non-zero exit.
    const pendingEntries = [...this.pending.values()];
    this.pending.clear();

    for (const pending of pendingEntries) {
      pending.resolve({
        jsonrpc: '2.0',
        id: pending.id,
        error: { code: -32603, message: 'Server shutting down' },
      });
    }

    try {
      await this.transport.close();
    } catch (error: unknown) {
      this.options.logger?.warn('MCP transport close failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.onclose?.();
    }
  }

  private handleIncoming(raw: unknown): Promise<unknown> {
    const maxPayloadBytes = this.options.maxPayloadBytes ?? MCP_MAX_PAYLOAD_BYTES;
    const size = payloadByteLength(raw);

    if (size > maxPayloadBytes) {
      this.options.logger?.warn('Rejected oversized MCP request payload', {
        bytes: size,
        maxBytes: maxPayloadBytes,
      });

      return Promise.resolve({
        jsonrpc: '2.0',
        id: extractRequestId(raw),
        error: {
          code: -32600,
          message: 'Request payload exceeds maximum size',
        },
      });
    }

    let message: JSONRPCMessage;

    try {
      message = parseMessage(raw);
    } catch (error: unknown) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));

      return Promise.reject(error);
    }

    if (!isRequest(message)) {
      this.onmessage?.(message);

      return Promise.resolve(undefined);
    }

    const key = requestKey(message.id);

    return new Promise<JSONRPCMessage>((resolve, reject) => {
      this.pending.set(key, { id: message.id, resolve, reject });

      try {
        this.onmessage?.(message);
      } catch (error: unknown) {
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}