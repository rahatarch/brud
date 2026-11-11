import { Buffer } from 'node:buffer';
import type { Socket } from 'node:net';
import type { DaemonCallerTier, DaemonClientIdentity } from '@brud/protocol';
import { NoiseHandshake } from './noise.js';
import type { NoiseCipherState, NoiseTransport } from './noise.js';

/** Hard ceiling for one Noise handshake message. */
export const MAX_HANDSHAKE_BYTES = 8 * 1024;

/** Hard ceiling for one encrypted transport record's plaintext. */
export const MAX_RECORD_PLAINTEXT_BYTES = 8 * 1024 * 1024;

/** Default deadline for completing the Noise handshake. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

const TAGLEN = 16;
const MAX_RECORD_BYTES = 1 + MAX_RECORD_PLAINTEXT_BYTES + TAGLEN;

/** Constant channel-binding prefix mixed into every Noise prologue. */
export const CHANNEL_PROLOGUE_PREFIX = 'brud-daemon-channel-v1';

/** Binds a handshake to the endpoint both parties believe they are using. */
export function channelPrologue(socketPath: string): Buffer {
  return Buffer.from(`${CHANNEL_PROLOGUE_PREFIX}\0${socketPath}`, 'utf8');
}

/**
 * Record type, authenticated as the AEAD associated data.
 *
 * Direction separation comes from the two Noise cipher states; type
 * separation comes from this byte. A record reflected with a different type
 * fails authentication.
 */
export const RECORD_REQUEST = 1;
export const RECORD_NOTIFICATION = 2;
export const RECORD_SUCCESS = 3;
export const RECORD_ERROR = 4;

export type RecordType =
  | typeof RECORD_REQUEST
  | typeof RECORD_NOTIFICATION
  | typeof RECORD_SUCCESS
  | typeof RECORD_ERROR;

const RECORD_TYPES: ReadonlySet<number> = new Set([
  RECORD_REQUEST,
  RECORD_NOTIFICATION,
  RECORD_SUCCESS,
  RECORD_ERROR,
]);

export interface SecureChannelHandshakeContext {
  readonly principal: DaemonCallerTier;
  readonly workspaceRoot: string;
  readonly clientInfo?: DaemonClientIdentity;
  readonly capabilities?: readonly string[];
}

export interface SecureChannelServerContext {
  readonly name: string;
  readonly version: string;
  readonly pid: number;
}

export interface SecureChannelOptions {
  readonly prologue: Buffer;
  readonly handshakeTimeoutMs?: number;
  readonly maxRecordBytes?: number;
}

export interface SecureChannelAcceptOptions extends SecureChannelOptions {
  readonly psks: readonly {
    readonly principal: DaemonCallerTier;
    readonly psk: Buffer;
  }[];
  /** Validates the client-claimed workspace before the channel opens. */
  readonly validateWorkspaceRoot: (workspaceRoot: string) => void;
  readonly server: SecureChannelServerContext;
}

export interface SecureChannelConnectOptions extends SecureChannelOptions {
  readonly psk: Buffer;
  readonly context: SecureChannelHandshakeContext;
}

export type SecureChannelMessageListener = (type: RecordType, text: string) => void;

interface HandshakePayload {
  readonly v: 1;
  readonly principal: DaemonCallerTier;
  readonly workspaceRoot: string;
  readonly clientInfo?: DaemonClientIdentity;
  readonly capabilities?: readonly string[];
}

interface ServerPayload {
  readonly v: 1;
  readonly server: SecureChannelServerContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHandshakePayload(text: string): HandshakePayload {
  const value: unknown = JSON.parse(text);

  if (!isRecord(value) || value.v !== 1) {
    throw new Error('Invalid handshake payload version');
  }

  const principal = value.principal;
  const workspaceRoot = value.workspaceRoot;

  if (principal !== 'ui' && principal !== 'ai') {
    throw new Error('Invalid handshake principal');
  }

  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new Error('Invalid handshake workspace root');
  }

  const clientInfo = parseIdentity(value.clientInfo);
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter((entry): entry is string => typeof entry === 'string')
    : undefined;

  return {
    v: 1,
    principal,
    workspaceRoot,
    ...(clientInfo === undefined ? {} : { clientInfo }),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

function parseServerPayload(text: string): ServerPayload {
  const value: unknown = JSON.parse(text);

  if (!isRecord(value) || value.v !== 1) {
    throw new Error('Invalid server handshake payload');
  }

  const server = value.server;

  if (
    !isRecord(server)
    || typeof server.name !== 'string'
    || typeof server.version !== 'string'
    || typeof server.pid !== 'number'
    || !Number.isInteger(server.pid)
  ) {
    throw new Error('Invalid server identity payload');
  }

  return {
    v: 1,
    server: { name: server.name, version: server.version, pid: server.pid },
  };
}

function parseIdentity(value: unknown): DaemonClientIdentity | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.version !== 'string') {
    return undefined;
  }

  return { name: value.name, version: value.version };
}

function encodeHandshakeFrame(message: Buffer): Buffer {
  if (message.length > MAX_HANDSHAKE_BYTES) {
    throw new Error('Noise handshake message exceeds the size limit');
  }

  const frame = Buffer.allocUnsafe(4 + message.length);
  frame.writeUInt32BE(message.length, 0);
  message.copy(frame, 4);

  return frame;
}

function classifyMessage(message: unknown): RecordType {
  if (isRecord(message) && typeof message.method === 'string') {
    return 'id' in message ? RECORD_REQUEST : RECORD_NOTIFICATION;
  }

  if (isRecord(message) && 'error' in message) {
    return RECORD_ERROR;
  }

  return RECORD_SUCCESS;
}

/**
 * Authenticated, AEAD-protected record channel over one local socket.
 *
 * The handshake is two Noise NNpsk0 messages; every message after it is a
 * length-prefixed record whose type is bound into the AEAD associated data.
 * Authentication failure, nonce reuse, a replayed record, or an invalid
 * record shape destroys the connection: there is no fallback to plaintext.
 */
export class SecureChannel {
  private readonly socket: Socket;

  private readonly options: SecureChannelOptions;

  private readonly maxRecordBytes: number;

  private sendState: NoiseCipherState | undefined;

  private receiveState: NoiseCipherState | undefined;

  private handshakeHash: Buffer | undefined;

  private buffer: Buffer = Buffer.alloc(0);

  private phase: 'handshaking' | 'open' | 'closed' = 'handshaking';

  private messageListener: SecureChannelMessageListener | undefined;

  private closeListener: (() => void) | undefined;

  private handshakeTimer: NodeJS.Timeout | undefined;

  private resolveHandshake: ((handshake: HandshakeResult) => void) | undefined;

  private rejectHandshake: ((error: Error) => void) | undefined;

  private handshakeDone: Promise<HandshakeResult>;

  private handshakeResolved = false;

  private constructor(socket: Socket, options: SecureChannelOptions) {
    this.socket = socket;
    this.options = options;
    this.maxRecordBytes = Math.min(
      options.maxRecordBytes ?? MAX_RECORD_BYTES,
      MAX_RECORD_BYTES,
    );
    this.handshakeDone = new Promise<HandshakeResult>((resolve, reject) => {
      this.resolveHandshake = resolve;
      this.rejectHandshake = reject;
    });
    this.handshakeDone.catch(() => undefined);

    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => {
      this.onData(chunk);
    });
    socket.on('error', () => {
      this.fail(new Error('Secure channel socket error'));
    });
    socket.on('close', () => {
      this.fail(new Error('Secure channel closed'));
    });
  }

  static async connect(
    socket: Socket,
    options: SecureChannelConnectOptions,
  ): Promise<{ channel: SecureChannel; server: SecureChannelServerContext }> {
    const channel = new SecureChannel(socket, options);
    const handshake = new NoiseHandshake({
      role: 'initiator',
      psk: options.psk,
      prologue: options.prologue,
    });
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      principal: options.context.principal,
      workspaceRoot: options.context.workspaceRoot,
      ...(options.context.clientInfo === undefined
        ? {}
        : { clientInfo: options.context.clientInfo }),
      ...(options.context.capabilities === undefined
        ? {}
        : { capabilities: options.context.capabilities }),
    }), 'utf8');

    channel.beginHandshakeTimeout();
    channel.writeRaw(encodeHandshakeFrame(handshake.writeMessage(payload)));

    try {
      const result = await channel.handshakeDone;

      timerClear(channel.handshakeTimer);
      channel.handshakeTimer = undefined;

      if (channel.isClosed) {
        throw new Error('Secure channel closed during the handshake');
      }

      const serverPayload = handshake.readMessage(result.serverPayload);

      channel.installTransport(result, handshake);

      return {
        channel,
        server: parseServerPayload(serverPayload.toString('utf8')).server,
      };
    } catch (error: unknown) {
      channel.destroy();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  static async accept(
    socket: Socket,
    options: SecureChannelAcceptOptions,
  ): Promise<{ channel: SecureChannel; context: SecureChannelHandshakeContext }> {
    const channel = new SecureChannel(socket, options);
    const serverPayload = Buffer.from(JSON.stringify({
      v: 1,
      server: options.server,
    }), 'utf8');

    channel.beginHandshakeTimeout();

    try {
      const result = await channel.handshakeDone;
      const first = result.firstHandshakeMessage;

      if (channel.isClosed || first === undefined) {
        throw new Error('Noise initiator message is missing');
      }

      let accepted:
        | {
            handshake: NoiseHandshake;
            context: SecureChannelHandshakeContext;
          }
        | undefined;

      for (const candidate of options.psks) {
        try {
          const handshake = new NoiseHandshake({
            role: 'responder',
            psk: candidate.psk,
            prologue: options.prologue,
          });
          const plaintext = handshake.readMessage(first);
          const payload = parseHandshakePayload(plaintext.toString('utf8'));

          if (payload.principal !== candidate.principal) {
            continue;
          }

          options.validateWorkspaceRoot(payload.workspaceRoot);
          accepted = { handshake, context: payload };
          break;
        } catch {
          continue;
        }
      }

      if (accepted === undefined) {
        throw new Error('Noise handshake authentication failed');
      }

      channel.writeRaw(encodeHandshakeFrame(accepted.handshake.writeMessage(serverPayload)));
      timerClear(channel.handshakeTimer);
      channel.handshakeTimer = undefined;
      channel.installTransport(
        { firstHandshakeMessage: undefined, serverPayload: Buffer.alloc(0) },
        accepted.handshake,
      );

      return { channel, context: accepted.context };
    } catch (error: unknown) {
      channel.destroy();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  onMessage(listener: SecureChannelMessageListener): void {
    this.messageListener = listener;
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  get isClosed(): boolean {
    return this.phase === 'closed';
  }

  get binding(): Buffer | undefined {
    return this.handshakeHash === undefined ? undefined : Buffer.from(this.handshakeHash);
  }

  send(message: unknown): void {
    this.sendTyped(classifyMessage(message), JSON.stringify(message));
  }

  /**
   * Sends raw JSON text of a chosen type through the real encryption path.
   *
   * Test clients use this to inject malformed or hostile plaintext after the
   * handshake; the daemon's post-decryption validation is still the real path.
   */
  sendRaw(text: string, type: RecordType = RECORD_REQUEST): void {
    this.sendTyped(type, text);
  }

  end(): void {
    if (this.phase === 'closed') {
      return;
    }

    this.phase = 'closed';
    timerClear(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.socket.end();
    this.socket.destroy();
    this.notifyClose();
  }

  destroy(): void {
    if (this.phase === 'closed') {
      return;
    }

    this.phase = 'closed';
    timerClear(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.socket.destroy();
    this.notifyClose();
  }

  private sendTyped(type: RecordType, text: string): void {
    if (this.phase !== 'open' || this.sendState === undefined) {
      throw new Error('Secure channel is not open');
    }

    const plaintext = Buffer.from(text, 'utf8');

    if (plaintext.length > MAX_RECORD_PLAINTEXT_BYTES) {
      throw new Error('Record plaintext exceeds the size limit');
    }

    const ciphertext = this.sendState.encrypt(Buffer.from([type]), plaintext);
    const frame = Buffer.allocUnsafe(4 + 1 + ciphertext.length);
    frame.writeUInt32BE(1 + ciphertext.length, 0);
    frame.writeUInt8(type, 4);
    ciphertext.copy(frame, 5);

    this.writeRaw(frame);
  }

  private beginHandshakeTimeout(): void {
    const timeoutMs = this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.handshakeTimer = setTimeout(() => {
      this.fail(new Error(`Noise handshake timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    this.handshakeTimer.unref?.();
  }

  private installTransport(result: HandshakeResult, handshake: NoiseHandshake): void {
    if (this.phase === 'closed') {
      throw new Error('Secure channel closed during the handshake');
    }

    const transport: NoiseTransport = handshake.split();

    this.sendState = transport.send;
    this.receiveState = transport.receive;
    this.handshakeHash = transport.handshakeHash;
    this.phase = 'open';
    this.handshakeResolved = false;
    this.resolveHandshake?.(result);
    this.resolveHandshake = undefined;
    this.rejectHandshake = undefined;

    // A peer may have pipelined a transport record into the same chunk as the
    // final handshake message. Pump it now that the keys are installed.
    this.pump();
  }

  private onData(chunk: Buffer): void {
    if (this.phase === 'closed') {
      return;
    }

    if (this.buffer.length + chunk.length > this.maxBufferBytes()) {
      this.fail(new Error('Secure channel buffer limit exceeded'));
      return;
    }

    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.pump();
  }

  private maxBufferBytes(): number {
    const frameLimit = this.phase === 'handshaking'
      ? MAX_HANDSHAKE_BYTES
      : this.maxRecordBytes;

    return frameLimit + 4;
  }

  private pump(): void {
    for (;;) {
      if (this.phase === 'closed' || this.handshakeResolved) {
        return;
      }

      if (this.buffer.length < 4) {
        return;
      }

      const length = this.buffer.readUInt32BE(0);

      if (this.phase === 'handshaking') {
        if (length === 0 || length > MAX_HANDSHAKE_BYTES) {
          this.fail(new Error('Invalid Noise handshake frame length'));
          return;
        }

        if (this.buffer.length < 4 + length) {
          return;
        }

        const message = Buffer.from(this.buffer.subarray(4, 4 + length));
        this.buffer = this.buffer.subarray(4 + length);
        this.deliverHandshakeMessage(message);
        continue;
      }

      if (length < 1 + TAGLEN || length > this.maxRecordBytes) {
        this.fail(new Error('Invalid encrypted record length'));
        return;
      }

      if (this.buffer.length < 4 + length) {
        return;
      }

      const type = this.buffer.readUInt8(4);
      const ciphertext = Buffer.from(this.buffer.subarray(5, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);

      if (!RECORD_TYPES.has(type)) {
        this.fail(new Error(`Unknown record type ${String(type)}`));
        return;
      }

      if (this.receiveState === undefined) {
        this.fail(new Error('Encrypted record received before the handshake completed'));
        return;
      }

      let plaintext: Buffer;

      try {
        plaintext = this.receiveState.decrypt(Buffer.from([type]), ciphertext);
      } catch {
        this.fail(new Error('Record authentication failed'));
        return;
      }

      const listener = this.messageListener;

      if (listener !== undefined) {
        listener(type as RecordType, plaintext.toString('utf8'));
      }
    }
  }

  private deliverHandshakeMessage(message: Buffer): void {
    if (this.phase !== 'handshaking' || this.handshakeResolved) {
      this.fail(new Error('Unexpected handshake message'));
      return;
    }

    // The first handshake frame is either the initiator's message (server
    // side) or the responder's reply (client side). The role is not stored on
    // the channel, so stash it and let the static factory interpret it.
    this.handshakeResolved = true;
    this.resolveHandshake?.({
      firstHandshakeMessage: message,
      serverPayload: message,
    });
    this.resolveHandshake = undefined;
    this.rejectHandshake = undefined;
  }

  private writeRaw(frame: Buffer): void {
    if (this.phase === 'closed' || this.socket.destroyed) {
      return;
    }

    try {
      this.socket.write(frame);
    } catch {
      this.destroy();
    }
  }

  private fail(error: Error): void {
    if (this.phase === 'closed') {
      return;
    }

    this.phase = 'closed';
    timerClear(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.rejectHandshake?.(error);
    this.resolveHandshake = undefined;
    this.rejectHandshake = undefined;

    if (!this.socket.destroyed) {
      this.socket.destroy();
    }

    this.notifyClose();
  }

  private notifyClose(): void {
    const listener = this.closeListener;
    this.closeListener = undefined;
    listener?.();
  }
}

interface HandshakeResult {
  readonly firstHandshakeMessage: Buffer | undefined;
  readonly serverPayload: Buffer;
}

function timerClear(timer: NodeJS.Timeout | undefined): void {
  if (timer !== undefined) {
    clearTimeout(timer);
  }
}