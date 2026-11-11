/**
 * Phase 13.0 adversarial verification harness.
 *
 * This is test support only. It boots the real daemon CLI as a child process,
 * waits for the real Unix-domain socket (or Windows named pipe), and speaks
 * raw newline-delimited JSON-RPC over `node:net`. Nothing is mocked: the
 * daemon boots a real kernel, real official plugins, and a real
 * `DurableNodeStorageDriver`-backed workspace.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DurableNodeStorageDriver } from '@brud/kernel' with { 'resolution-mode': 'import' };
import * as Protocol from '@brud/protocol';
import {
  channelPrologue,
  RECORD_REQUEST,
  SecureChannel,
} from '../security/channel.js';
import type { RecordType } from '../security/channel.js';
import { derivePsk } from '../security/noise.js';
import { resolveEndpoint } from '../lifecycle/endpoint.js';

/** Repository root, four directories above this file. */
export const REPO_ROOT = resolve(__dirname, '../../../..');

/** Daemon TypeScript entry point executed through tsx. */
export const DAEMON_SOURCE_CLI = join(REPO_ROOT, 'packages', 'daemon', 'src', 'cli.ts');

/** Maximum time to wait for the daemon socket and token files. */
export const DAEMON_BOOT_TIMEOUT_MS = 30_000;

/** Default per-request timeout for the raw client. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface RawJsonRpcFrame {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly data?: unknown;
  };
}

interface PendingRequest {
  readonly resolve: (frame: RawJsonRpcFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface FrameWaiter {
  readonly predicate: (frame: RawJsonRpcFrame) => boolean;
  readonly from: number;
  readonly resolve: (frame: RawJsonRpcFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms);
    timer.unref?.();
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Raw JSON-RPC client over a real socket.
 *
 * `sendRaw` bypasses every client-side serializer so tests can send malformed
 * JSON, JSON-RPC batch arrays, and arbitrarily large frames verbatim.
 */
export interface RawClientSecurity {
  readonly psk: string;
  readonly principal: 'ui' | 'ai';
  readonly workspaceRoot: string;
  readonly prologue: Buffer;
}

/**
 * Raw JSON-RPC client over a real, authenticated secure channel.
 *
 * `sendRaw` bypasses every client-side serializer so tests can send malformed
 * JSON, JSON-RPC batch arrays, and arbitrarily large frames verbatim. The
 * plaintext still travels through the production Noise/AEAD path; the daemon's
 * post-decryption validator is the real one.
 */
export class RawJsonRpcClient {
  /** Every parsed frame received, in arrival order. */
  public readonly frames: RawJsonRpcFrame[] = [];

  /** Every physical response payload received, before parsing. */
  public readonly rawFrames: string[] = [];

  /** Response payloads that were not valid JSON. */
  public readonly nonJsonLines: string[] = [];

  private readonly socket: Socket;

  private readonly channel: SecureChannel;

  private readonly pending = new Map<number, PendingRequest>();

  private readonly waiters = new Set<FrameWaiter>();

  private nextId = 1;

  private closed = false;

  private constructor(socket: Socket, channel: SecureChannel) {
    this.socket = socket;
    this.channel = channel;

    channel.onMessage((type: RecordType, text: string) => {
      this.consume(type, text);
    });
    channel.onClose(() => {
      this.closed = true;
      this.failAll(new Error('Raw secure channel closed'));
    });
    socket.on('error', () => {
      this.failAll(new Error('Raw socket error'));
    });
    socket.on('close', () => {
      this.closed = true;
      this.failAll(new Error('Raw socket closed'));
    });
  }

  /** Opens a real connection and completes the real Noise handshake. */
  public static async connect(
    socketPath: string,
    security?: RawClientSecurity,
    timeoutMs: number = 5_000,
  ): Promise<RawJsonRpcClient> {
    const deadline = Date.now() + timeoutMs;

    if (security === undefined) {
      throw new Error('RawJsonRpcClient.connect requires a principal key and scope');
    }

    for (;;) {
      const socket = createConnection(socketPath);

      try {
        await new Promise<void>((resolveConnect, rejectConnect) => {
          const onConnect = (): void => {
            socket.off('error', onError);
            resolveConnect();
          };
          const onError = (error: Error): void => {
            socket.off('connect', onConnect);
            rejectConnect(error);
          };

          socket.once('connect', onConnect);
          socket.once('error', onError);
        });

        const { channel } = await SecureChannel.connect(socket, {
          psk: derivePsk(security.psk),
          prologue: security.prologue,
          context: {
            principal: security.principal,
            workspaceRoot: security.workspaceRoot,
          },
          handshakeTimeoutMs: timeoutMs,
        });

        return new RawJsonRpcClient(socket, channel);
      } catch (error: unknown) {
        socket.destroy();

        if (Date.now() >= deadline) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        await delay(50);
      }
    }
  }

  public get isOpen(): boolean {
    return !this.closed && !this.channel.isClosed;
  }

  /**
   * Writes raw plaintext request records exactly as supplied.
   *
   * Newline-delimited input is split into one authenticated record per line,
   * matching the daemon's one-record-per-message contract. Multiple lines may
   * arrive in one call; each is independently validated by the daemon.
   */
  public sendRaw(line: string): void {
    if (!this.isOpen) {
      throw new Error('Cannot write to a closed raw JSON-RPC client');
    }

    const lines = line.split('\n');

    for (const rawLine of lines) {
      const record = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (record.length === 0) {
        continue;
      }

      this.channel.sendRaw(record, RECORD_REQUEST);
    }
  }

  /**
   * Writes arbitrary bytes to the real socket, bypassing the channel's
   * sender-side bound. Used to model a hostile peer that does not use this
   * client's framing; the daemon's receiver-side bound remains the control.
   */
  public sendUnframedBytes(bytes: Buffer): void {
    if (this.socket.destroyed) {
      throw new Error('Cannot write to a closed raw JSON-RPC client');
    }

    this.socket.write(bytes);
  }

  /** Serializes and sends one JSON-RPC message. */
  public send(message: unknown): void {
    if (!this.isOpen) {
      throw new Error('Cannot write to a closed raw JSON-RPC client');
    }

    this.channel.send(message);
  }

  /** Sends a request and resolves with the response carrying the same id. */
  public request(
    method: string,
    params?: unknown,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<RawJsonRpcFrame> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<RawJsonRpcFrame>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for method "${method}" (id=${id})`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.send({
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
    });
  }

  /** Sends a notification (no id, no response expected). */
  public notify(method: string, params?: unknown): void {
    this.send({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  /** Marks the current frame index for `waitForFrame`. */
  public mark(): number {
    return this.frames.length;
  }

  /**
   * Waits for a frame that satisfies `predicate`.
   *
   * Frames already received at or after `from` are considered first, so a
   * response that arrived before this call is never lost.
   */
  public waitForFrame(
    predicate: (frame: RawJsonRpcFrame) => boolean,
    options: { readonly from?: number; readonly timeoutMs?: number } = {},
  ): Promise<RawJsonRpcFrame> {
    const from = options.from ?? 0;
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    for (let index = from; index < this.frames.length; index += 1) {
      const frame = this.frames[index];

      if (frame !== undefined && predicate(frame)) {
        return Promise.resolve(frame);
      }
    }

    return new Promise<RawJsonRpcFrame>((resolveFrame, rejectFrame) => {
      const waiter: FrameWaiter = {
        predicate,
        from,
        resolve: (frame) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolveFrame(frame);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          rejectFrame(error);
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          rejectFrame(new Error('Timed out waiting for a matching raw JSON-RPC frame'));
        }, timeoutMs),
      };

      waiter.timer.unref?.();
      this.waiters.add(waiter);
    });
  }

  /**
   * Waits until at least `count` frames at or after `from` match `predicate`.
   *
   * Used for responses that intentionally share `id: null` (malformed JSON and
   * batch-array rejections), where `request` cannot address them by id.
   */
  public async waitForCount(
    predicate: (frame: RawJsonRpcFrame) => boolean,
    count: number,
    options: { readonly from?: number; readonly timeoutMs?: number } = {},
  ): Promise<readonly RawJsonRpcFrame[]> {
    const from = options.from ?? 0;
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const matching = this.frames.slice(from).filter(predicate);

      if (matching.length >= count) {
        return matching;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${count} matching raw JSON-RPC frames (saw ${matching.length})`,
        );
      }

      await delay(20);
    }
  }

  /** Waits until the socket is closed by the peer or by `destroy`. */
  public async waitForClose(timeoutMs: number = 5_000): Promise<boolean> {
    if (this.closed || this.socket.destroyed) {
      return true;
    }

    return await Promise.race([
      once(this.socket, 'close').then(() => true),
      delay(timeoutMs).then(() => false),
    ]);
  }

  /** Gracefully ends the secure channel. */
  public async close(): Promise<void> {
    if (this.socket.destroyed) {
      return;
    }

    this.channel.end();
    await this.waitForClose(1_000);
    this.socket.destroy();
  }

  /** Hard-destroys the socket, used for mid-flight disconnect attacks. */
  public destroy(): void {
    this.closed = true;
    this.channel.destroy();

    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  private consume(type: RecordType, text: string): void {
    // The daemon never initiates requests; only responses and notifications
    // are valid server-to-client records.
    if (type === RECORD_REQUEST) {
      return;
    }

    this.rawFrames.push(text);

    let frame: RawJsonRpcFrame;

    try {
      frame = JSON.parse(text) as RawJsonRpcFrame;
    } catch {
      this.nonJsonLines.push(text);
      return;
    }

    this.frames.push(frame);
    this.deliverPending(frame);
    this.deliverWaiters(frame);
  }

  private deliverPending(frame: RawJsonRpcFrame): void {
    if (typeof frame.id !== 'number') {
      return;
    }

    const pending = this.pending.get(frame.id);

    if (pending === undefined) {
      return;
    }

    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    pending.resolve(frame);
  }

  private deliverWaiters(frame: RawJsonRpcFrame): void {
    for (const waiter of [...this.waiters]) {
      if (this.frames.length - 1 < waiter.from) {
        continue;
      }

      if (waiter.predicate(frame)) {
        waiter.resolve(frame);
      }
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }

    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

export interface AttackWorkspace {
  readonly root: string;
  readonly driver: DurableNodeStorageDriver;
}

/**
 * Creates a real temporary workspace through `DurableNodeStorageDriver`.
 *
 * The seed `.brudignore` exists before boot so the self-destruction attack has
 * a concrete target rather than a missing-file shortcut.
 */
export async function createAttackWorkspace(
  prefix: string = 'brud-redteam-',
): Promise<AttackWorkspace> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const kernelModule = await import('@brud/kernel');
  const driver = new kernelModule.DurableNodeStorageDriver();

  await driver.mkdir(root, { recursive: true });
  await driver.writeFile(join(root, '.brudignore'), 'node_modules/\ndist/\n');
  await driver.writeFile(join(root, 'seed.txt'), 'adversarial seed\n');

  return { root, driver };
}

export interface StartDaemonOptions {
  /** Temporary-directory prefix for the workspace. */
  readonly prefix?: string;
  /** Runs after the workspace exists and before the daemon boots. */
  readonly seed?: (workspace: AttackWorkspace) => Promise<void>;
}

export interface AttackDaemon {
  readonly workspaceRoot: string;
  readonly runtimeDir: string;
  readonly socketPath: string;
  readonly tokenPath: string;
  readonly aiTokenPath: string;
  readonly token: string;
  readonly aiToken: string;
  readonly prologue: Buffer;
  readonly process: ChildProcessWithoutNullStreams;
  readonly stdout: () => string;
  readonly stderr: () => string;
  /** Opens a fresh authenticated connection to the daemon socket. */
  connect(options?: {
    readonly principal?: 'ui' | 'ai';
    readonly workspaceRoot?: string;
  }): Promise<RawJsonRpcClient>;
  /** Opens a fresh connection and performs the real `daemon.connect`. */
  connectAndHandshake(): Promise<{
    readonly client: RawJsonRpcClient;
    readonly result: Protocol.DaemonHandshakeResult;
  }>;
  /** Performs `daemon.connect` on an existing authenticated connection. */
  handshake(client: RawJsonRpcClient): Promise<Protocol.DaemonHandshakeResult>;
  /** Whether the daemon process is still addressable. */
  isAlive(): boolean;
  /** Stops the daemon and removes the workspace and runtime directory. */
  stop(): Promise<void>;
}

async function waitForBoot(
  process: ChildProcessWithoutNullStreams,
  metaPath: string,
  tokenPath: string,
  aiTokenPath: string,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + DAEMON_BOOT_TIMEOUT_MS;

  for (;;) {
    if (process.exitCode !== null) {
      throw new Error(
        `daemon exited during boot with code ${String(process.exitCode)}\n${stderr()}`,
      );
    }

    if (
      await pathExists(metaPath)
      && await pathExists(tokenPath)
      && await pathExists(aiTokenPath)
    ) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(`daemon did not publish ${metaPath} within ${DAEMON_BOOT_TIMEOUT_MS}ms\n${stderr()}`);
    }

    await delay(50);
  }
}

function isPidAlive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Boots one real daemon process on an isolated temporary runtime directory.
 *
 * The runtime directory is set through `BRUD_DAEMON_RUNTIME_DIR`, so
 * concurrent test files never share a socket, token, or lock.
 */
export async function startAttackDaemon(
  options: StartDaemonOptions = {},
): Promise<AttackDaemon> {
  const workspace = await createAttackWorkspace(options.prefix);

  if (options.seed !== undefined) {
    await options.seed(workspace);
  }

  const runtimeDir = await realpath(await mkdtemp(join(tmpdir(), 'brud-redteam-runtime-')));
  const previousRuntimeDir = process.env.BRUD_DAEMON_RUNTIME_DIR;
  process.env.BRUD_DAEMON_RUNTIME_DIR = runtimeDir;

  let endpoint: Awaited<ReturnType<typeof resolveEndpoint>>;

  try {
    endpoint = await resolveEndpoint(workspace.root);
  } finally {
    if (previousRuntimeDir === undefined) {
      delete process.env.BRUD_DAEMON_RUNTIME_DIR;
    } else {
      process.env.BRUD_DAEMON_RUNTIME_DIR = previousRuntimeDir;
    }
  }

  const socketPath = endpoint.socketPath;
  const tokenPath = endpoint.tokenPath;
  const aiTokenPath = endpoint.aiTokenPath;
  const metaPath = endpoint.metaPath;
  const lockPath = endpoint.lockPath;
  const prologue = channelPrologue(socketPath);

  let stdout = '';
  let stderr = '';

  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      DAEMON_SOURCE_CLI,
      '--foreground',
      '--workspace',
      workspace.root,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BRUD_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ) as ChildProcessWithoutNullStreams;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  try {
    await waitForBoot(child, metaPath, tokenPath, aiTokenPath, () => stderr);
  } catch (error: unknown) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), delay(5_000)]);
    await rm(workspace.root, { recursive: true, force: true });
    await rm(runtimeDir, { recursive: true, force: true });
    await rm(tokenPath, { force: true }).catch(() => undefined);
    await rm(aiTokenPath, { force: true }).catch(() => undefined);
    await rm(metaPath, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const token = (await readFile(tokenPath, 'utf8')).trim();
  const aiToken = (await readFile(aiTokenPath, 'utf8')).trim();

  const connect = async (options: {
    readonly principal?: 'ui' | 'ai';
    readonly workspaceRoot?: string;
  } = {}): Promise<RawJsonRpcClient> => {
    const principal = options.principal ?? 'ui';

    return await RawJsonRpcClient.connect(socketPath, {
      psk: principal === 'ai' ? aiToken : token,
      principal,
      workspaceRoot: options.workspaceRoot ?? workspace.root,
      prologue,
    });
  };

  const handshake = async (
    client: RawJsonRpcClient,
  ): Promise<Protocol.DaemonHandshakeResult> => {
    const frame = await client.request(Protocol.DAEMON_CONNECT, {
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      clientInfo: { name: 'brud-redteam-client', version: '0.0.1' },
    });

    if (frame.error !== undefined) {
      throw new Error(
        `daemon.connect failed (${String(frame.error.code)}): ${String(frame.error.message)}`,
      );
    }

    return frame.result as Protocol.DaemonHandshakeResult;
  };

  return {
    workspaceRoot: workspace.root,
    runtimeDir,
    socketPath,
    tokenPath,
    aiTokenPath,
    token,
    aiToken,
    prologue,
    process: child,
    stdout: () => stdout,
    stderr: () => stderr,
    connect,
    handshake,
    connectAndHandshake: async () => {
      const client = await connect();
      const result = await handshake(client);

      return { client, result };
    },
    isAlive: () => isPidAlive(child.pid) && child.exitCode === null,
    stop: async (): Promise<void> => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');

        const exited = await Promise.race([
          once(child, 'exit').then(() => true),
          delay(10_000).then(() => false),
        ]);

        if (!exited && child.exitCode === null) {
          child.kill('SIGKILL');
          await Promise.race([once(child, 'exit'), delay(5_000)]);
        }
      }

      await rm(workspace.root, { recursive: true, force: true });
      await rm(runtimeDir, { recursive: true, force: true });
      await rm(tokenPath, { force: true }).catch(() => undefined);
      await rm(aiTokenPath, { force: true }).catch(() => undefined);
      await rm(metaPath, { force: true }).catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    },
  };
}

/** A response whose `result` is a daemon `tools.execute` payload. */
export interface ToolExecuteFrame extends RawJsonRpcFrame {
  readonly result?: {
    readonly result?: {
      readonly status?: string;
      readonly data?: unknown;
      readonly message?: string;
      readonly error?: string;
    };
  };
}

/** Extracts the nested `tools.execute` operation result. */
export function toolResultOf(frame: RawJsonRpcFrame): {
  readonly status?: string;
  readonly data?: unknown;
  readonly message?: string;
  readonly error?: string;
} {
  return (frame as ToolExecuteFrame).result?.result ?? {};
}

/** Extracts a stable text rendering of a tool error. */
export function toolErrorText(frame: RawJsonRpcFrame): string {
  const result = toolResultOf(frame);
  const data = result.data as { readonly code?: unknown; readonly rule?: unknown } | undefined;
  const code = typeof data?.code === 'string' ? data.code : '';
  const rule = typeof data?.rule === 'string' ? data.rule : '';

  return [result.error, result.message, code, rule]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join(' | ');
}

