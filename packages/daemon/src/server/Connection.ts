import type {
  DaemonCallerTier,
  JsonRpcId,
  RpcNotification,
  RpcRequest,
  RpcResponse,
} from '@brud/protocol';
import * as Protocol from '@brud/protocol';
import type { SecureChannel, SecureChannelHandshakeContext, RecordType } from '../security/channel.js';
import {
  JsonContractError,
  parseStrictJson,
  validateIncomingEnvelope,
} from './protocolValidation.js';
import type { DispatchSession, RequestDispatcher } from './dispatch.js';
import { createRpcErrorResponse } from './wireErrors.js';

/** How long a cancellation waits for the operation to settle before acking. */
const CANCEL_ACK_GRACE_MS = 5_000;

/** Default ceiling on concurrent in-flight requests per connection. */
export const DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION = 64;

/** Default server-side deadline for one request. */
export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 5 * 60_000;

export interface ConnectionActivityHooks {
  readonly onRequestStart?: () => void;
  readonly onRequestEnd?: () => void;
}

export interface ConnectionLimits {
  readonly maxInFlight?: number;
  readonly requestTimeoutMs?: number;
}

interface InFlightRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  timer: NodeJS.Timeout | undefined;
  operationStatus: string | undefined;
  finished: boolean;
}

function readCancelId(value: unknown): JsonRpcId | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (!('id' in value)) {
    return undefined;
  }

  const id: unknown = value.id;

  if (typeof id === 'string' || typeof id === 'number' || id === null) {
    return id;
  }

  return undefined;
}

function readOperationStatus(response: RpcResponse): string | undefined {
  if (!('result' in response)) {
    return undefined;
  }

  const result: unknown = response.result;

  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return undefined;
  }

  const nested = (result as { result?: unknown }).result;

  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    const status = (nested as { status?: unknown }).status;

    if (typeof status === 'string') {
      return status;
    }
  }

  const status = (result as { status?: unknown }).status;

  return typeof status === 'string' ? status : undefined;
}

function cancelAckFor(
  entry: InFlightRequest,
  settled: boolean,
): Protocol.RequestCancelledParams {
  if (!settled) {
    return {
      id: entry.id,
      status: 'aborting',
      message: `Cancellation was delivered to "${entry.method}" but it did not settle within ${CANCEL_ACK_GRACE_MS} ms.`,
    };
  }

  if (entry.operationStatus === 'aborted') {
    return {
      id: entry.id,
      status: 'cancelled',
      message: `Cancellation stopped "${entry.method}".`,
    };
  }

  if (entry.operationStatus === 'success') {
    return {
      id: entry.id,
      status: 'not-abortable',
      message: `"${entry.method}" does not honor cancellation and completed.`,
    };
  }

  return {
    id: entry.id,
    status: 'not-abortable',
    message: `"${entry.method}" finished with status "${entry.operationStatus ?? 'unknown'}" after cancellation.`,
  };
}

/**
 * One authenticated daemon connection.
 *
 * The principal and workspace are already fixed by the Noise session. This
 * class enforces the post-handshake JSON-RPC contract, request correlation,
 * the in-flight ceiling, and the per-request deadline.
 */
export class Connection implements DispatchSession {
  readonly connectionId: string;

  workspaceRoot: string | undefined;

  /** Principal fixed by the authenticated handshake. */
  tier: DaemonCallerTier | undefined;

  private readonly channel: SecureChannel;

  private readonly dispatcher: RequestDispatcher;

  private readonly hooks: ConnectionActivityHooks;

  private readonly closeListeners = new Set<() => void>();

  private readonly maxInFlight: number;

  private readonly requestTimeoutMs: number;

  /**
   * Serializes ordinary request dispatch. Cancellation notifications
   * deliberately bypass this chain.
   */
  private requestChain: Promise<void> = Promise.resolve();

  private readonly inFlight = new Map<JsonRpcId, InFlightRequest>();

  private handshakeCompleted = false;

  private closed = false;

  constructor(
    connectionId: string,
    channel: SecureChannel,
    context: SecureChannelHandshakeContext,
    dispatcher: RequestDispatcher,
    hooks: ConnectionActivityHooks = {},
    limits: ConnectionLimits = {},
  ) {
    this.connectionId = connectionId;
    this.channel = channel;
    this.dispatcher = dispatcher;
    this.hooks = hooks;
    this.workspaceRoot = context.workspaceRoot;
    this.tier = context.principal;
    this.maxInFlight = Math.max(
      1,
      Math.trunc(limits.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION),
    );
    this.requestTimeoutMs = Math.max(
      1,
      Math.trunc(limits.requestTimeoutMs ?? DEFAULT_SERVER_REQUEST_TIMEOUT_MS),
    );

    channel.onMessage((type: RecordType, text: string) => {
      this.handleRecord(type, text);
    });
    channel.onClose(() => {
      this.closed = true;
      this.abortInFlight();
      this.notifyClose();
    });
  }

  get handshaken(): boolean {
    return this.handshakeCompleted;
  }

  get isClosed(): boolean {
    return this.closed || this.channel.isClosed;
  }

  markHandshaken(): void {
    this.handshakeCompleted = true;
  }

  onClose(listener: () => void): void {
    if (this.closed || this.channel.isClosed) {
      listener();
      return;
    }

    this.closeListeners.add(listener);
  }

  destroy(): void {
    this.closed = true;
    this.abortInFlight();
    this.channel.destroy();
    this.notifyClose();
  }

  end(): void {
    this.closed = true;
    this.abortInFlight();
    this.channel.end();
    this.notifyClose();
  }

  private handleRecord(type: RecordType, text: string): void {
    if (this.closed) {
      return;
    }

    let value: unknown;

    try {
      value = parseStrictJson(text);
    } catch (error: unknown) {
      if (error instanceof JsonContractError) {
        this.send(
          createRpcErrorResponse(
            error.frameId,
            Protocol.PARSE_ERROR,
            error.message,
          ),
        );
        return;
      }

      this.handleFatalError(error);
      return;
    }

    const envelope = validateIncomingEnvelope(value, type);

    if (!envelope.ok) {
      this.send(createRpcErrorResponse(envelope.id, envelope.code, envelope.message));
      return;
    }

    if (envelope.kind === 'notification') {
      this.handleNotification(envelope.notification);
      return;
    }

    this.scheduleRequest(envelope.request);
  }

  private handleNotification(notification: RpcNotification): void {
    if (notification.method === Protocol.REQUEST_CANCEL) {
      void this.handleCancel(notification.params, undefined);
    }
  }

  private scheduleRequest(request: RpcRequest): void {
    if (request.method === Protocol.REQUEST_CANCEL) {
      if (!this.handshaken) {
        this.send(
          createRpcErrorResponse(
            request.id,
            Protocol.HANDSHAKE_REQUIRED,
            'request.cancel requires a completed daemon handshake',
          ),
        );
        return;
      }

      void this.handleCancel(request.params, request.id);
      return;
    }

    if (this.inFlight.has(request.id)) {
      this.send(
        createRpcErrorResponse(
          request.id,
          Protocol.INVALID_REQUEST,
          'A request with this id is already in flight',
        ),
      );
      return;
    }

    if (this.inFlight.size >= this.maxInFlight) {
      this.send(
        createRpcErrorResponse(
          request.id,
          Protocol.RESOURCE_EXHAUSTED,
          `The connection already has ${this.maxInFlight} requests in flight`,
        ),
      );
      return;
    }

    const entry = this.registerInFlight(request);

    this.requestChain = this.requestChain
      .then(async () => {
        // A request the client abandoned before it started must not run.
        if (entry.finished || entry.controller.signal.aborted) {
          entry.operationStatus = 'aborted';
          this.finishInFlight(entry);
          return;
        }

        await this.dispatchRequest(request, entry);
      })
      .catch((error: unknown) => {
        this.handleFatalError(error);
      });
  }

  private registerInFlight(request: RpcRequest): InFlightRequest {
    const controller = new AbortController();
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });

    const entry: InFlightRequest = {
      id: request.id,
      method: request.method,
      controller,
      settled,
      resolveSettled,
      timer: undefined,
      operationStatus: undefined,
      finished: false,
    };

    entry.timer = setTimeout(() => {
      this.timeoutInFlight(entry);
    }, this.requestTimeoutMs);
    entry.timer.unref?.();

    this.inFlight.set(request.id, entry);
    this.hooks.onRequestStart?.();

    return entry;
  }

  private async dispatchRequest(
    request: RpcRequest,
    entry: InFlightRequest,
  ): Promise<void> {
    let response: RpcResponse;

    try {
      response = await this.dispatcher.dispatch(request, this, {
        signal: entry.controller.signal,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unexpected dispatch failure';
      response = createRpcErrorResponse(request.id, Protocol.INTERNAL_ERROR, message);
    }

    if (entry.finished) {
      // The deadline or a disconnect already answered this request.
      return;
    }

    entry.operationStatus = readOperationStatus(response);

    try {
      this.send(response);
    } finally {
      this.finishInFlight(entry);
    }
  }

  private timeoutInFlight(entry: InFlightRequest): void {
    if (entry.finished) {
      return;
    }

    entry.controller.abort();
    entry.operationStatus = 'aborted';
    this.send(
      createRpcErrorResponse(
        entry.id,
        Protocol.REQUEST_TIMEOUT,
        `Request "${entry.method}" exceeded its ${this.requestTimeoutMs} ms deadline`,
      ),
    );
    this.finishInFlight(entry);
  }

  private finishInFlight(entry: InFlightRequest): void {
    if (entry.finished) {
      return;
    }

    entry.finished = true;

    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }

    entry.resolveSettled();

    if (this.inFlight.get(entry.id) === entry) {
      this.inFlight.delete(entry.id);
    }

    this.hooks.onRequestEnd?.();
  }

  private abortInFlight(): void {
    for (const entry of this.inFlight.values()) {
      if (!entry.finished) {
        entry.controller.abort();
      }
    }
  }

  /**
   * Delivers cancellation to the in-flight operation and acknowledges the
   * observed outcome.
   *
   * `requestId` is defined when the caller sent `request.cancel` as a request;
   * in that case the ack is that request's result. Otherwise the ack is the
   * additive `request.cancelled` notification.
   */
  private async handleCancel(
    value: unknown,
    requestId: JsonRpcId | undefined,
  ): Promise<void> {
    const cancelledId = readCancelId(value);

    if (cancelledId === undefined) {
      this.deliverCancelAck(requestId, {
        id: null,
        status: 'invalid',
        message: 'request.cancel requires an object with a string, number, or null "id".',
      });
      return;
    }

    const entry = this.inFlight.get(cancelledId);

    if (entry === undefined) {
      this.deliverCancelAck(requestId, {
        id: cancelledId,
        status: 'not-found',
        message: 'No matching request is in flight.',
      });
      return;
    }

    entry.controller.abort();
    const settled = await this.waitForSettlement(entry);

    this.deliverCancelAck(requestId, cancelAckFor(entry, settled));
  }

  private async waitForSettlement(entry: InFlightRequest): Promise<boolean> {
    if (entry.finished) {
      return true;
    }

    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), CANCEL_ACK_GRACE_MS);
      timer.unref?.();
    });

    try {
      return await Promise.race([entry.settled.then(() => true), grace]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private deliverCancelAck(
    requestId: JsonRpcId | undefined,
    ack: Protocol.RequestCancelledParams,
  ): void {
    if (requestId !== undefined) {
      this.send({ jsonrpc: '2.0', id: requestId, result: ack });
      return;
    }

    this.send({
      jsonrpc: '2.0',
      method: Protocol.REQUEST_CANCELLED,
      params: ack,
    });
  }

  private send(message: RpcResponse | RpcNotification): void {
    if (this.closed || this.channel.isClosed) {
      return;
    }

    try {
      this.channel.send(message);
    } catch {
      this.destroy();
    }
  }

  private handleFatalError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unexpected connection failure';
    this.send(createRpcErrorResponse(null, Protocol.INTERNAL_ERROR, message));
    this.destroy();
  }

  private notifyClose(): void {
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();

    for (const listener of listeners) {
      listener();
    }
  }
}