import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer, Socket } from 'node:net';
import type { Server } from 'node:net';
import type {
  BrudKernel,
  IActionManager,
  IBrudToolsService,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DaemonCallerTier } from '@brud/protocol';
import { Connection } from './Connection.js';
import { RequestDispatcher } from './dispatch.js';
import {
  canonicalizeWorkspaceRoot,
  validateAuthenticatedWorkspaceRoot,
} from './handshake.js';
import { loadKernelModule } from '../kernelRuntime.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';
import {
  channelPrologue,
  SecureChannel,
} from '../security/channel.js';
import type { SecureChannelHandshakeContext } from '../security/channel.js';
import { enforceEndpointOwnership } from '../security/ownership.js';
import {
  captureExpectedPeer,
  isPipePeer,
  loadPeerCredentialHost,
  PeerCredentialError,
  verifyPeerCredentials,
  verifyWindowsPeer,
} from '../security/peerCredentials.js';
import type {
  ExpectedPeer,
  PipeListener,
  PipePeer,
  PipeRefused,
} from '../security/peerCredentials.js';
import { derivePsk } from '../security/noise.js';
import * as DaemonVersion from '../version.js';

/** Default ceiling on simultaneously open local connections. */
export const DEFAULT_MAX_CONNECTIONS = 64;

function isAbortedAccept(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { readonly code?: unknown }).code === 'ECANCELED';
}

export interface DaemonServerConfig {
  /** Multi-workspace registry. Preferred over `kernel`. */
  readonly registry?: WorkspaceRegistry;

  /** Single-kernel composition adopted for `workspaceRoot`. */
  readonly kernel?: BrudKernel;
  readonly socketPath: string;

  /**
   * Per-principal pre-shared keys used to authenticate the Noise handshake.
   * `ui` and `ai` are distinct, so the principal is fixed by whichever PSK
   * authenticates rather than by a request field.
   */
  readonly principals: Readonly<Record<DaemonCallerTier, string>>;

  readonly workspaceRoot: string;
  readonly serverName?: string;
  readonly serverVersion?: string;

  /**
   * Restricts authenticated handshakes to `workspaceRoot`.
   *
   * A registry-backed daemon may serve several workspaces; a daemon bound to a
   * single workspace endpoint must not be widened by a client handshake.
   */
  readonly enforcePrimaryRoot?: boolean;

  /** Maximum simultaneously open connections. */
  readonly maxConnections?: number;

  /** Maximum concurrent in-flight requests per connection. */
  readonly maxInFlightPerConnection?: number;

  /** Server-side deadline for one request. */
  readonly requestTimeoutMs?: number;

  /**
   * Process that is allowed to connect: normally the host that spawned the
   * daemon. Defaults to the current process, which is the host when the
   * daemon is embedded in it (tests and in-process embeddings).
   */
  readonly expectedPeerPid?: number;
}

export interface DaemonActivitySnapshot {
  readonly activeConnections: number;
  readonly inFlightRequests: number;
}

export type DaemonActivityListener = (snapshot: DaemonActivitySnapshot) => void;

export class DaemonServer {
  readonly socketPath: string;

  private readonly server: Server;

  private readonly dispatcher: RequestDispatcher;

  private readonly connections = new Map<string, Connection>();

  /** Sockets that have been accepted but have not finished the handshake. */
  private readonly handshaking = new Set<Socket>();

  private readonly activityListeners = new Set<DaemonActivityListener>();

  private readonly principals: Readonly<Record<DaemonCallerTier, string>>;

  private readonly primaryWorkspaceRoot: string;

  private readonly enforcePrimaryRoot: boolean;

  private readonly maxConnections: number;

  private readonly maxInFlightPerConnection: number | undefined;

  private readonly requestTimeoutMs: number | undefined;

  private readonly expectedPeerPid: number;

  private peerCredentialHost: Awaited<ReturnType<typeof loadPeerCredentialHost>> | undefined;

  private expectedPeer: ExpectedPeer | undefined;

  private pipeListener: PipeListener | undefined;

  private inFlightRequests = 0;

  private listening = false;

  private stopping = false;

  private closedPromise: Promise<void> | undefined;

  static async create(config: DaemonServerConfig): Promise<DaemonServer> {
    const kernelModule = await loadKernelModule();
    return new DaemonServer(
      config,
      kernelModule.BrudToolsToken,
      kernelModule.ActionManagerToken,
    );
  }

  private constructor(
    config: DaemonServerConfig,
    toolsToken: ServiceToken<IBrudToolsService>,
    actionsToken: ServiceToken<IActionManager>,
  ) {
    this.socketPath = config.socketPath;
    this.principals = config.principals;
    this.primaryWorkspaceRoot = canonicalizeWorkspaceRoot(config.workspaceRoot);
    this.enforcePrimaryRoot = config.enforcePrimaryRoot ?? (config.registry === undefined);
    this.maxConnections = Math.max(1, Math.trunc(config.maxConnections ?? DEFAULT_MAX_CONNECTIONS));
    this.maxInFlightPerConnection = config.maxInFlightPerConnection;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.expectedPeerPid = config.expectedPeerPid ?? process.pid;
    this.dispatcher = new RequestDispatcher({
      ...(config.registry === undefined ? {} : { registry: config.registry }),
      ...(config.kernel === undefined ? {} : { kernel: config.kernel }),
      toolsToken,
      actionsToken,
      workspaceRoot: config.workspaceRoot,
      serverName: config.serverName ?? DaemonVersion.DAEMON_SERVER_NAME,
      serverVersion: config.serverVersion ?? DaemonVersion.DAEMON_SERVER_VERSION,
    });
    this.server = createServer((socket: Socket) => {
      this.accept(socket);
    });
  }

  get connectionCount(): number {
    return this.connections.size + this.handshaking.size;
  }

  get inFlightCount(): number {
    return this.inFlightRequests;
  }

  get activity(): DaemonActivitySnapshot {
    return {
      activeConnections: this.connectionCount,
      inFlightRequests: this.inFlightRequests,
    };
  }

  onActivity(listener: DaemonActivityListener): () => void {
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
    };
  }

  async listen(): Promise<void> {
    if (this.listening) {
      throw new Error('Daemon server is already listening');
    }

    if (process.platform === 'win32') {
      await this.listenWindows();
    } else {
      await this.listenPosix();
    }

    this.listening = true;
  }

  private async listenPosix(): Promise<void> {
    // Capture the expected peer before the socket can accept anything. The
    // credential helper is prebuilt; it is never compiled at install time.
    const host = await loadPeerCredentialHost();
    this.peerCredentialHost = host;
    this.expectedPeer = captureExpectedPeer(host, this.expectedPeerPid);

    const previousUmask = process.umask(0o177);

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          this.server.off('listening', onListening);
          reject(error);
        };

        const onListening = (): void => {
          this.server.off('error', onError);
          resolve();
        };

        this.server.once('error', onError);
        this.server.once('listening', onListening);
        this.server.listen(this.socketPath);
      });
    } finally {
      process.umask(previousUmask);
    }

    const ownership = await enforceEndpointOwnership(this.socketPath);

    if (ownership.status === 'unsupported') {
      process.stderr.write(
        `brud-daemon: peer endpoint ownership is not verifiable on ${ownership.platform}: ${ownership.reason}\n`,
      );
    }
  }

  private async listenWindows(): Promise<void> {
    // The Windows helper owns the named pipe: it creates every instance with a
    // protected DACL for this user, rejects remote clients, and reads the
    // connecting process's PID, token user SID, and creation time before
    // handing the connection to Node. Capture the expected host first so no
    // connection can arrive before the baseline exists.
    const host = await loadPeerCredentialHost();
    this.peerCredentialHost = host;
    this.expectedPeer = captureExpectedPeer(host, this.expectedPeerPid);

    if (typeof host.listenPipe !== 'function') {
      throw new PeerCredentialError(
        'the installed peer-credential helper does not expose the Windows named-pipe listener',
      );
    }

    let listener: PipeListener;

    try {
      listener = host.listenPipe(this.socketPath);
    } catch (error: unknown) {
      throw new PeerCredentialError(
        `cannot serve the Windows named pipe "${this.socketPath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.pipeListener = listener;

    // Windows named pipes do not expose ownership or mode through node:fs, so
    // the existing file-ownership check keeps reporting `unsupported`. It stays
    // in the path as a visible layer; the helper's DACL and the client process
    // identity below are the Windows defenses.
    const ownership = await enforceEndpointOwnership(this.socketPath);

    if (ownership.status === 'unsupported') {
      process.stderr.write(
        `brud-daemon: peer endpoint ownership is not verifiable on ${ownership.platform}: ${ownership.reason}\n`,
      );
    }

    this.acceptPipeConnections(listener, this.expectedPeer);
  }

  private acceptPipeConnections(listener: PipeListener, expected: ExpectedPeer): void {
    const loop = async (): Promise<void> => {
      for (;;) {
        let result: PipePeer | PipeRefused;

        try {
          result = await listener.accept();
        } catch (error: unknown) {
          if (this.stopping || isAbortedAccept(error)) {
            return;
          }

          process.stderr.write(
            `brud-daemon: named-pipe accept failed: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
          );
          return;
        }

        if (this.stopping) {
          if (isPipePeer(result)) {
            this.discardPipePeer(result);
          }

          return;
        }

        if (!isPipePeer(result)) {
          // The helper already closed this connection unread because it could
          // not read the client's identity. Fail closed and keep serving.
          process.stderr.write(
            `brud-daemon: refused connection: ${result.refused}\n`,
          );
          continue;
        }

        let socket: Socket;

        try {
          verifyWindowsPeer(result, expected);
          socket = new Socket({ fd: result.fd });
        } catch (error: unknown) {
          const refusal = error instanceof Error
            ? error
            : new PeerCredentialError(String(error));

          try {
            socket = new Socket({ fd: result.fd });
          } catch {
            continue;
          }

          this.refuseConnection(socket, refusal);
          continue;
        }

        this.admit(socket);
      }
    };

    void loop();
  }

  private discardPipePeer(peer: PipePeer): void {
    try {
      new Socket({ fd: peer.fd }).destroy();
    } catch {
      // The descriptor is already unusable; nothing else can release it here.
    }
  }

  stopAccepting(): void {
    if (!this.listening) {
      return;
    }

    this.listening = false;
    this.stopping = true;

    if (process.platform === 'win32') {
      const listener = this.pipeListener;
      this.pipeListener = undefined;
      listener?.close();
      this.closedPromise = Promise.resolve();
      return;
    }

    this.closedPromise = new Promise<void>((resolve, reject) => {
      this.server.close((error?: Error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
    this.closedPromise.catch(() => undefined);
  }

  closeConnections(): void {
    for (const connection of this.connections.values()) {
      connection.end();
    }

    for (const socket of this.handshaking) {
      socket.destroy();
    }

    this.handshaking.clear();
    this.connections.clear();
    this.notifyActivity();
  }

  async close(): Promise<void> {
    this.stopAccepting();
    this.closeConnections();

    if (this.closedPromise !== undefined) {
      await this.closedPromise;
    }

    if (process.platform !== 'win32') {
      await rm(this.socketPath, { force: true });
    }
  }

  private accept(socket: Socket): void {
    if (process.platform !== 'win32') {
      const host = this.peerCredentialHost;
      const expectedPeer = this.expectedPeer;

      if (host === undefined || expectedPeer === undefined) {
        this.refuseConnection(
          socket,
          new PeerCredentialError('peer-credential verification is not initialized'),
        );
        return;
      }

      try {
        verifyPeerCredentials(socket, expectedPeer, host);
      } catch (error: unknown) {
        this.refuseConnection(
          socket,
          error instanceof Error ? error : new PeerCredentialError(String(error)),
        );
        return;
      }
    }

    this.admit(socket);
  }

  private admit(socket: Socket): void {
    if (this.connectionCount >= this.maxConnections) {
      // The limit is applied before the handshake or any dispatch work.
      socket.destroy();
      return;
    }

    this.handshaking.add(socket);
    this.notifyActivity();

    const prologue = channelPrologue(this.socketPath);
    const serverInfo = {
      name: DaemonVersion.DAEMON_SERVER_NAME,
      version: DaemonVersion.DAEMON_SERVER_VERSION,
      pid: process.pid,
    };

    void SecureChannel.accept(socket, {
      prologue,
      psks: [
        { principal: 'ui' as const, psk: derivePsk(this.principals.ui) },
        { principal: 'ai' as const, psk: derivePsk(this.principals.ai) },
      ],
      server: serverInfo,
      validateWorkspaceRoot: (workspaceRoot: string): void => {
        const outcome = validateAuthenticatedWorkspaceRoot(workspaceRoot, {
          primaryRoot: this.primaryWorkspaceRoot,
          enforcePrimary: this.enforcePrimaryRoot,
        });

        if (!outcome.ok) {
          throw new Error(outcome.message);
        }
      },
    }).then(({ channel, context }) => {
      this.handshaking.delete(socket);

      if (channel.isClosed) {
        this.notifyActivity();
        return;
      }

      this.attachConnection(channel, context);
    }).catch(() => {
      this.handshaking.delete(socket);

      if (!socket.destroyed) {
        socket.destroy();
      }

      this.notifyActivity();
    });
  }

  private refuseConnection(socket: Socket, error: Error): void {
    const message = `brud-daemon: refused connection: ${error.message}\n`;

    process.stderr.write(message);

    if (socket.destroyed) {
      return;
    }

    socket.once('error', () => undefined);
    socket.end(message, () => {
      socket.destroy();
    });
  }

  private attachConnection(
    channel: SecureChannel,
    context: SecureChannelHandshakeContext,
  ): void {
    const connectionId = `c_${randomUUID()}`;
    const connection = new Connection(connectionId, channel, context, this.dispatcher, {
      onRequestStart: () => {
        this.inFlightRequests += 1;
        this.notifyActivity();
      },
      onRequestEnd: () => {
        this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
        this.notifyActivity();
      },
    }, {
      ...(this.maxInFlightPerConnection === undefined
        ? {}
        : { maxInFlight: this.maxInFlightPerConnection }),
      ...(this.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: this.requestTimeoutMs }),
    });

    this.connections.set(connectionId, connection);
    connection.onClose(() => {
      this.connections.delete(connectionId);
      this.notifyActivity();
    });

    this.notifyActivity();
  }

  private notifyActivity(): void {
    if (this.activityListeners.size === 0) {
      return;
    }

    const snapshot = this.activity;

    for (const listener of this.activityListeners) {
      listener(snapshot);
    }
  }
}