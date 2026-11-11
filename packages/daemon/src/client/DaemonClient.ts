import type { Socket } from 'node:net';
import * as Protocol from '@brud/protocol';
import type {
  DaemonCallerTier,
  DaemonClientIdentity,
  DaemonConnectParams,
  DaemonHandshakeResult,
  JsonRpcId,
  RequestCancelStatus,
  RequestCancelledParams,
  RpcNotification,
  RpcRequest,
} from '@brud/protocol';
import {
  DaemonAuthError,
  DaemonDisconnectedError,
  DaemonRequestCancelledError,
  DaemonRequestTimeoutError,
  DaemonRpcError,
} from './errors.js';
import { derivePsk, NOISE_PROTOCOL_NAME } from '../security/noise.js';
import {
  RECORD_NOTIFICATION,
  RECORD_REQUEST,
  SecureChannel,
} from '../security/channel.js';
import type { RecordType } from '../security/channel.js';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const REQUEST_CANCEL_METHOD = Protocol.REQUEST_CANCEL;

const CLOSE_GRACE_MS = 1_000;

const CANCEL_STATUSES: ReadonlySet<RequestCancelStatus> = new Set([
  'cancelled',
  'not-abortable',
  'aborting',
  'not-found',
  'invalid',
]);

function readCancelAck(value: unknown): RequestCancelledParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (!('id' in value) || !('status' in value)) {
    return undefined;
  }

  const id = value.id;

  if (typeof id !== 'string' && typeof id !== 'number' && id !== null) {
    return undefined;
  }

  const status = value.status;

  if (typeof status !== 'string' || !CANCEL_STATUSES.has(status as RequestCancelStatus)) {
    return undefined;
  }

  const message = 'message' in value && typeof value.message === 'string'
    ? value.message
    : undefined;

  return {
    id,
    status: status as RequestCancelStatus,
    ...(message === undefined ? {} : { message }),
  };
}

export interface DaemonClientSecurity {
  /** Pre-shared key for the client's principal. */
  readonly psk: string;
  /** Principal fixed by the key that authenticates the handshake. */
  readonly principal: DaemonCallerTier;
  /** Workspace scope fixed by the authenticated handshake. */
  readonly workspaceRoot: string;
  /** Endpoint binding mixed into the Noise prologue. */
  readonly prologue: Buffer;
  readonly handshakeTimeoutMs?: number;
}

export interface DaemonRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly removeAbortListener: () => void;
}

function normalizeRequestTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }

  return Math.max(1, Math.trunc(value));
}

function castResult<TResult>(value: unknown): TResult {
  return value as TResult;
}

export class DaemonClient {
  private readonly socket: Socket;

  private readonly security: DaemonClientSecurity;

  private channel: SecureChannel | undefined;

  private readonly pendingRequests = new Map<string | number, PendingRequest>();

  private readonly cancelAckListeners = new Set<(ack: RequestCancelledParams) => void>();

  private nextRequestId = 1;

  private handshakeResult: DaemonHandshakeResult | undefined;

  private closed = false;

  private closePromise: Promise<void> | undefined;

  constructor(socket: Socket, security: DaemonClientSecurity) {
    this.socket = socket;
    this.security = security;
  }

  get isConnected(): boolean {
    return !this.closed
      && !this.socket.destroyed
      && this.channel !== undefined
      && !this.channel.isClosed;
  }

  get handshake(): DaemonHandshakeResult | undefined {
    return this.handshakeResult;
  }

  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  /** Protocol name of the authenticated channel, for diagnostics. */
  get securityProtocol(): string {
    return NOISE_PROTOCOL_NAME;
  }

  async connect(
    params: DaemonConnectParams,
    options?: DaemonRequestOptions,
  ): Promise<DaemonHandshakeResult> {
    if (this.channel === undefined) {
      await this.establishChannel();
    }

    const result = await this.request<DaemonHandshakeResult>(
      Protocol.DAEMON_CONNECT,
      params,
      options,
    );

    this.handshakeResult = result;

    return result;
  }

  request<TResult>(
    method: string,
    params?: unknown,
    options?: DaemonRequestOptions,
  ): Promise<TResult> {
    if (!this.isConnected || this.channel === undefined) {
      return Promise.reject(new DaemonDisconnectedError());
    }

    let timeoutMs: number;

    try {
      timeoutMs = normalizeRequestTimeout(options?.timeoutMs);
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<TResult>((resolve, reject) => {
      const signal = options?.signal;
      let sent = false;

      const timer = setTimeout(() => {
        const pending = this.pendingRequests.get(id);

        if (pending === undefined) {
          return;
        }

        this.complete(id, pending);
        reject(new DaemonRequestTimeoutError({ requestId: id, method, timeoutMs }));

        if (sent) {
          this.cancel(id);
        }
      }, timeoutMs);

      timer.unref?.();

      const onAbort = (): void => {
        const pending = this.pendingRequests.get(id);

        if (pending === undefined) {
          return;
        }

        this.complete(id, pending);
        reject(new DaemonRequestCancelledError({ requestId: id, method }));

        if (sent) {
          this.cancel(id);
        }
      };

      const pending: PendingRequest = {
        method,
        resolve: (value: unknown) => {
          resolve(castResult<TResult>(value));
        },
        reject,
        timer,
        removeAbortListener: () => {
          signal?.removeEventListener('abort', onAbort);
        },
      };

      this.pendingRequests.set(id, pending);

      if (signal?.aborted === true) {
        onAbort();
        return;
      }

      if (signal !== undefined) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const request: RpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      };

      try {
        this.channel?.send(request);
        sent = true;
      } catch (error: unknown) {
        this.complete(id, pending);
        reject(
          new DaemonDisconnectedError('Failed to send daemon request', { cause: error }),
        );
        this.socket.destroy();
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.isConnected || this.channel === undefined) {
      return;
    }

    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    };

    try {
      this.channel.send(notification);
    } catch (error: unknown) {
      this.handleSocketFailure(
        new DaemonDisconnectedError('Failed to send daemon notification', { cause: error }),
      );
      this.socket.destroy();
    }
  }

  cancel(requestId: JsonRpcId): void {
    this.notify(REQUEST_CANCEL_METHOD, { id: requestId });
  }

  /**
   * Observes the daemon's acknowledgment of a cancellation.
   *
   * Additive: the pre-existing timeout/cancel contract still rejects the
   * abandoned request locally; this listener reports what the daemon actually
   * did with the in-flight operation.
   */
  onCancelAck(listener: (ack: RequestCancelledParams) => void): () => void {
    this.cancelAckListeners.add(listener);

    return () => {
      this.cancelAckListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closePromise = this.shutdown();
    return this.closePromise;
  }

  private async establishChannel(): Promise<void> {
    try {
      const { channel } = await SecureChannel.connect(this.socket, {
        psk: derivePsk(this.security.psk),
        prologue: this.security.prologue,
        context: {
          principal: this.security.principal,
          workspaceRoot: this.security.workspaceRoot,
        },
        ...(this.security.handshakeTimeoutMs === undefined
          ? {}
          : { handshakeTimeoutMs: this.security.handshakeTimeoutMs }),
      });

      this.channel = channel;
      channel.onMessage((type, text) => {
        this.handleMessage(type, text);
      });
      channel.onClose(() => {
        this.handleSocketFailure(new DaemonDisconnectedError('Daemon connection closed'));
      });
    } catch (error: unknown) {
      this.closed = true;
      throw new DaemonAuthError(
        `Authenticated daemon channel failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  private async shutdown(): Promise<void> {
    this.closed = true;
    this.failPending(new DaemonDisconnectedError('Daemon client closed'));

    const channel = this.channel;

    if (channel !== undefined) {
      channel.end();
    } else if (!this.socket.destroyed) {
      this.socket.destroy();
    }

    if (this.socket.destroyed) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (timer !== undefined) {
          clearTimeout(timer);
        }

        this.socket.off('close', onClose);
        resolve();
      };

      const onClose = (): void => {
        finish();
      };

      timer = setTimeout(() => {
        this.socket.destroy();
        finish();
      }, CLOSE_GRACE_MS);
      timer.unref?.();

      this.socket.once('close', onClose);

      if (this.socket.destroyed) {
        finish();
      }
    });
  }

  private handleMessage(type: RecordType, text: string): void {
    if (this.closed) {
      return;
    }

    // The server sends responses and notifications only. A server-initiated
    // request would be a protocol violation; it is ignored rather than
    // dispatched by the client.
    if (type === RECORD_REQUEST) {
      return;
    }

    let message: unknown;

    try {
      message = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      this.handleSocketFailure(
        new DaemonDisconnectedError('Daemon sent invalid JSON', { cause: error }),
      );
      this.socket.destroy();
      return;
    }

    if (type === RECORD_NOTIFICATION) {
      if (Protocol.isRpcNotification(message) && message.method === Protocol.REQUEST_CANCELLED) {
        const ack = readCancelAck(message.params);

        if (ack !== undefined) {
          for (const listener of [...this.cancelAckListeners]) {
            listener(ack);
          }
        }
      }

      return;
    }

    if (!Protocol.isRpcResponse(message) || message.id === null) {
      return;
    }

    const pending = this.pendingRequests.get(message.id);

    if (pending === undefined) {
      return;
    }

    this.complete(message.id, pending);

    if (Protocol.isRpcErrorResponse(message)) {
      pending.reject(
        new DaemonRpcError({
          code: message.error.code,
          message: message.error.message,
          method: pending.method,
          requestId: message.id,
          ...(message.error.data === undefined ? {} : { details: message.error.data }),
        }),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private complete(id: string | number, pending: PendingRequest): void {
    this.pendingRequests.delete(id);
    clearTimeout(pending.timer);
    pending.removeAbortListener();
  }

  private handleSocketFailure(error: DaemonDisconnectedError): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.failPending(error);
  }

  private failPending(error: Error): void {
    if (this.pendingRequests.size === 0) {
      return;
    }

    const pending = [...this.pendingRequests.values()];
    this.pendingRequests.clear();

    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.removeAbortListener();
      entry.reject(error);
    }
  }
}