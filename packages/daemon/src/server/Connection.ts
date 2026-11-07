import type { Socket } from 'node:net';
import * as Protocol from '@brud/protocol';
import type { RpcResponse } from '@brud/protocol';
import { FrameError, NdjsonFramingStream } from './framing.js';
import type { FrameResult } from './framing.js';
import type { DispatchSession, RequestDispatcher } from './dispatch.js';
import { createRpcErrorResponse } from './wireErrors.js';

export interface ConnectionActivityHooks {
  readonly onRequestStart?: () => void;
  readonly onRequestEnd?: () => void;
}

export class Connection implements DispatchSession {
  readonly connectionId: string;

  workspaceRoot: string | undefined;

  private readonly socket: Socket;

  private readonly dispatcher: RequestDispatcher;

  private readonly hooks: ConnectionActivityHooks;

  private readonly framing = new NdjsonFramingStream();

  private pending: Promise<void> = Promise.resolve();

  private handshakeCompleted = false;

  private closed = false;

  constructor(
    connectionId: string,
    socket: Socket,
    dispatcher: RequestDispatcher,
    hooks: ConnectionActivityHooks = {},
  ) {
    this.connectionId = connectionId;
    this.socket = socket;
    this.dispatcher = dispatcher;
    this.hooks = hooks;

    this.socket.setNoDelay(true);
    this.socket.on('data', (chunk: Buffer) => {
      this.enqueue(chunk);
    });
    this.socket.on('close', () => {
      this.closed = true;
    });
  }

  get handshaken(): boolean {
    return this.handshakeCompleted;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  markHandshaken(): void {
    this.handshakeCompleted = true;
  }

  onClose(listener: () => void): void {
    this.socket.on('close', listener);
  }

  destroy(): void {
    this.closed = true;

    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  end(): void {
    this.closed = true;

    if (this.socket.destroyed) {
      return;
    }

    this.socket.end();
    this.socket.destroy();
  }

  private enqueue(chunk: Buffer): void {
    this.pending = this.pending
      .then(() => this.processChunk(chunk))
      .catch((error: unknown) => {
        this.handleFatalError(error);
      });
  }

  private async processChunk(chunk: Buffer): Promise<void> {
    let results: FrameResult[];

    try {
      results = this.framing.pushFrames(chunk);
    } catch (error: unknown) {
      if (error instanceof FrameError) {
        // A frame-length violation is fatal for the connection: the raw bytes
        // are rejected before JSON parsing and the client must reconnect.
        this.send(createRpcErrorResponse(null, error.rpcCode, error.message));

        if (error.code === 'FRAME_OVERSIZE') {
          this.end();
        }

        return;
      }

      throw error;
    }

    for (const result of results) {
      if (!result.ok) {
        // A malformed complete frame only fails itself. Valid frames that
        // shared the same transport chunk are still processed below.
        this.send(
          createRpcErrorResponse(result.frameId, result.error.rpcCode, result.error.message),
        );
        continue;
      }

      const message = result.message;

      if (Protocol.isRpcNotification(message)) {
        continue;
      }

      if (!Protocol.isRpcRequest(message)) {
        this.send(
          createRpcErrorResponse(null, Protocol.INVALID_REQUEST, 'Expected a JSON-RPC request'),
        );
        continue;
      }

      this.hooks.onRequestStart?.();

      try {
        const response = await this.dispatcher.dispatch(message, this);
        this.send(response);
      } finally {
        this.hooks.onRequestEnd?.();
      }
    }
  }

  private send(response: RpcResponse): void {
    if (this.closed || this.socket.destroyed) {
      return;
    }

    try {
      this.socket.write(this.framing.encode(response));
    } catch {
      this.destroy();
    }
  }

  private handleFatalError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unexpected connection failure';
    this.send(createRpcErrorResponse(null, Protocol.INTERNAL_ERROR, message));
    this.destroy();
  }
}
