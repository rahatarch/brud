import { Buffer } from 'node:buffer';
import type { Socket } from 'node:net';
import * as Protocol from '@brud/protocol';
import type {
  DaemonConnectParams,
  DaemonHandshakeResult,
  FileEncoding,
  FsExistsResult,
  FsListEntry,
  FsListResult,
  FsReadFileResult,
  FsWriteAtomicResult,
  JsonRpcId,
  RpcNotification,
  RpcRequest,
} from '@brud/protocol';
import {
  DaemonDisconnectedError,
  DaemonRequestCancelledError,
  DaemonRequestTimeoutError,
  DaemonRpcError,
} from './errors.js';
import { NdjsonFramingStream } from '../server/framing.js';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const REQUEST_CANCEL_METHOD = 'request.cancel';

const CLOSE_GRACE_MS = 1_000;

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

  private readonly framing = new NdjsonFramingStream();

  private readonly pendingRequests = new Map<string | number, PendingRequest>();

  private nextRequestId = 1;

  private handshakeResult: DaemonHandshakeResult | undefined;

  private closed = false;

  private closePromise: Promise<void> | undefined;

  constructor(socket: Socket) {
    this.socket = socket;

    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => {
      this.handleChunk(chunk);
    });
    socket.on('error', (error: Error) => {
      this.handleSocketFailure(
        new DaemonDisconnectedError('Daemon connection failed', { cause: error }),
      );
      socket.destroy();
    });
    socket.on('end', () => {
      this.handleSocketFailure(new DaemonDisconnectedError('Daemon connection ended'));
      socket.destroy();
    });
    socket.on('close', () => {
      this.handleSocketFailure(new DaemonDisconnectedError('Daemon connection closed'));
    });
  }

  get isConnected(): boolean {
    return !this.closed && !this.socket.destroyed;
  }

  get handshake(): DaemonHandshakeResult | undefined {
    return this.handshakeResult;
  }

  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  async connect(
    params: DaemonConnectParams,
    options?: DaemonRequestOptions,
  ): Promise<DaemonHandshakeResult> {
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
    if (!this.isConnected) {
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
        this.socket.write(this.framing.encode(request));
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
    if (!this.isConnected) {
      return;
    }

    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    };

    try {
      this.socket.write(this.framing.encode(notification));
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

  async fsReadFile(path: string, encoding: FileEncoding = 'utf8'): Promise<string> {
    const result = await this.request<FsReadFileResult>(Protocol.FS_READ_FILE, {
      path,
      encoding,
    });

    return result.data;
  }

  async fsWriteAtomic(
    path: string,
    data: Uint8Array | string,
    encoding: FileEncoding = 'utf8',
  ): Promise<FsWriteAtomicResult> {
    const payload = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
    const payloadEncoding: FileEncoding = typeof data === 'string' ? encoding : 'base64';
    const result = await this.request<FsWriteAtomicResult>(Protocol.FS_WRITE_ATOMIC, {
      path,
      data: payload,
      encoding: payloadEncoding,
    });

    return result;
  }

  async fsExists(path: string): Promise<boolean> {
    const result = await this.request<FsExistsResult>(Protocol.FS_EXISTS, { path });
    return result.exists;
  }

  async fsList(path: string, limit?: number): Promise<readonly FsListEntry[]> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new RangeError('limit must be a non-negative integer');
    }

    const result = await this.request<FsListResult>(Protocol.FS_LIST, { path });

    return limit === undefined ? result.entries : result.entries.slice(0, limit);
  }

  async close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closePromise = this.shutdown();
    return this.closePromise;
  }

  private async shutdown(): Promise<void> {
    this.closed = true;
    this.failPending(new DaemonDisconnectedError('Daemon client closed'));

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
      this.socket.end();

      if (this.socket.destroyed) {
        finish();
      }
    });
  }

  private handleChunk(chunk: Buffer): void {
    if (this.closed) {
      return;
    }

    let messages: unknown[];

    try {
      messages = this.framing.push(chunk);
    } catch (error: unknown) {
      this.handleSocketFailure(
        new DaemonDisconnectedError('Daemon sent an invalid frame', { cause: error }),
      );
      this.socket.destroy();
      return;
    }

    for (const message of messages) {
      this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
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
