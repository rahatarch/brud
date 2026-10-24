import { unlink } from 'node:fs/promises';
import type { KernelLifecycleState } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { DaemonActivitySnapshot } from '../server/DaemonServer.js';
import type { DaemonEndpoint } from './endpoint.js';

export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

export interface ShutdownServer {
  readonly inFlightCount: number;
  stopAccepting(): void;
  closeConnections(): void;
  onActivity(listener: (snapshot: DaemonActivitySnapshot) => void): () => void;
}

export interface ShutdownKernel {
  readonly lifecycleState: KernelLifecycleState;
  shutdown(): Promise<void>;
}

export interface GracefulShutdownCoordinatorOptions {
  readonly server: ShutdownServer;
  readonly kernel: ShutdownKernel;
  readonly endpoint: DaemonEndpoint;
  readonly drainTimeoutMs?: number;
  readonly beforeTeardown?: () => void;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (readErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}

export class GracefulShutdownCoordinator {
  private readonly server: ShutdownServer;

  private readonly kernel: ShutdownKernel;

  private readonly endpoint: DaemonEndpoint;

  private readonly drainTimeoutMs: number;

  private readonly beforeTeardown: (() => void) | undefined;

  private shutdownPromise: Promise<void> | undefined;

  constructor(options: GracefulShutdownCoordinatorOptions) {
    this.server = options.server;
    this.kernel = options.kernel;
    this.endpoint = options.endpoint;
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.beforeTeardown = options.beforeTeardown;
  }

  get isShuttingDown(): boolean {
    return this.shutdownPromise !== undefined;
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.runShutdown();
    return this.shutdownPromise;
  }

  private async runShutdown(): Promise<void> {
    this.beforeTeardown?.();

    let firstError: unknown;

    try {
      this.server.stopAccepting();
      await this.drainInFlightRequests();
      this.server.closeConnections();

      if (this.kernel.lifecycleState === 'RUNNING') {
        await this.kernel.shutdown();
      }
    } catch (error: unknown) {
      firstError = error;
    }

    try {
      await this.cleanupArtifacts();
    } catch (error: unknown) {
      firstError ??= error;
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  private async drainInFlightRequests(): Promise<void> {
    if (this.server.inFlightCount === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      let unsubscribe: (() => void) | undefined;
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

        unsubscribe?.();
        resolve();
      };

      timer = setTimeout(finish, this.drainTimeoutMs);
      timer.unref();

      unsubscribe = this.server.onActivity((snapshot) => {
        if (snapshot.inFlightRequests === 0) {
          finish();
        }
      });

      if (this.server.inFlightCount === 0) {
        finish();
      }
    });
  }

  private async cleanupArtifacts(): Promise<void> {
    if (!this.endpoint.isWindows) {
      await unlinkIfPresent(this.endpoint.socketPath);
    }

    await unlinkIfPresent(this.endpoint.tokenPath);
    await unlinkIfPresent(this.endpoint.lockPath);
    await unlinkIfPresent(this.endpoint.metaPath);
  }
}
