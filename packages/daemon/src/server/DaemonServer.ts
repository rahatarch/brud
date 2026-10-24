import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type {
  BrudKernel,
  IBrudFileSystem,
  IUniversalHistoryService,
  ServiceToken,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import { Connection } from './Connection.js';
import { RequestDispatcher } from './dispatch.js';
import { loadKernelModule } from '../kernelRuntime.js';
import * as DaemonVersion from '../version.js';

export interface DaemonServerConfig {
  readonly kernel: BrudKernel;
  readonly socketPath: string;
  readonly token: string;
  readonly workspaceRoot: string;
  readonly serverName?: string;
  readonly serverVersion?: string;
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

  private readonly activityListeners = new Set<DaemonActivityListener>();

  private inFlightRequests = 0;

  private listening = false;

  private closedPromise: Promise<void> | undefined;

  static async create(config: DaemonServerConfig): Promise<DaemonServer> {
    const kernelModule = await loadKernelModule();
    return new DaemonServer(
      config,
      kernelModule.FileSystemToken,
      kernelModule.UniversalHistoryToken,
    );
  }

  private constructor(
    config: DaemonServerConfig,
    fileSystemToken: ServiceToken<IBrudFileSystem>,
    historyToken: ServiceToken<IUniversalHistoryService>,
  ) {
    this.socketPath = config.socketPath;
    this.dispatcher = new RequestDispatcher({
      kernel: config.kernel,
      fileSystemToken,
      historyToken,
      token: config.token,
      workspaceRoot: config.workspaceRoot,
      serverName: config.serverName ?? DaemonVersion.DAEMON_SERVER_NAME,
      serverVersion: config.serverVersion ?? DaemonVersion.DAEMON_SERVER_VERSION,
    });
    this.server = createServer((socket: Socket) => {
      this.accept(socket);
    });
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get inFlightCount(): number {
    return this.inFlightRequests;
  }

  get activity(): DaemonActivitySnapshot {
    return {
      activeConnections: this.connections.size,
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

    this.listening = true;
  }

  stopAccepting(): void {
    if (!this.listening) {
      return;
    }

    this.listening = false;
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
    const connectionId = `c_${randomUUID()}`;
    const connection = new Connection(connectionId, socket, this.dispatcher, {
      onRequestStart: () => {
        this.inFlightRequests += 1;
        this.notifyActivity();
      },
      onRequestEnd: () => {
        this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
        this.notifyActivity();
      },
    });

    this.connections.set(connectionId, connection);
    connection.onClose(() => {
      this.connections.delete(connectionId);
      this.notifyActivity();
    });
    socket.on('error', () => {
      connection.destroy();
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
