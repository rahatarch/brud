import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import type { BrudKernel, IStorageDriver } from '@brud/kernel' with { 'resolution-mode': 'import' };
import * as Protocol from '@brud/protocol';
import { IdleMonitor } from '../lifecycle/idle.js';
import { acquireDaemonLock } from '../lifecycle/lock.js';
import type { LockHandle } from '../lifecycle/lock.js';
import { resolveEndpoint } from '../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import { GracefulShutdownCoordinator } from '../lifecycle/shutdown.js';
import { createKernel } from '../kernelRuntime.js';
import { DaemonServer } from './DaemonServer.js';
import * as DaemonVersion from '../version.js';

export interface CreateDaemonOptions {
  readonly workspaceRoot: string;
  readonly idleTimeoutMs?: number;
  readonly storageDriver?: IStorageDriver;
}

export interface DaemonMetadataRecord {
  readonly pid: number;
  readonly version: string;
  readonly protocolVersion: string;
  readonly workspaceRoot: string;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly tokenPath: string;
  readonly startedAt: number;
}

export interface RunningDaemon {
  readonly endpoint: DaemonEndpoint;
  readonly token: string;
  readonly lock: LockHandle;
  readonly kernel: BrudKernel;
  readonly server: DaemonServer;
  readonly idleMonitor: IdleMonitor;
  readonly isShuttingDown: () => boolean;
  readonly shutdown: () => Promise<void>;
}

interface DaemonRuntime {
  readonly kernel: BrudKernel;
  readonly server: DaemonServer;
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

async function rollbackStartup(
  endpoint: DaemonEndpoint,
  lock: LockHandle,
  kernel: BrudKernel | undefined,
  server: DaemonServer | undefined,
): Promise<void> {
  if (server !== undefined) {
    await server.close().catch(() => undefined);
  }

  if (kernel !== undefined && kernel.lifecycleState === 'RUNNING') {
    await kernel.shutdown().catch(() => undefined);
  }

  await unlinkIfPresent(endpoint.tokenPath).catch(() => undefined);
  await unlinkIfPresent(endpoint.metaPath).catch(() => undefined);
  await lock.release().catch(() => undefined);
}

async function startRuntime(
  endpoint: DaemonEndpoint,
  lock: LockHandle,
  token: string,
  options: CreateDaemonOptions,
): Promise<DaemonRuntime> {
  let kernel: BrudKernel | undefined;
  let server: DaemonServer | undefined;

  try {
    await writeFile(endpoint.tokenPath, token, { encoding: 'utf8', mode: 0o600 });

    const createdKernel = await createKernel({ storageDriver: options.storageDriver });
    kernel = createdKernel;
    await createdKernel.boot({ workspaceRoot: endpoint.workspaceRoot });

    const createdServer = await DaemonServer.create({
      kernel: createdKernel,
      socketPath: endpoint.socketPath,
      token,
      workspaceRoot: endpoint.workspaceRoot,
    });
    server = createdServer;
    await createdServer.listen();

    const metadata: DaemonMetadataRecord = {
      pid: process.pid,
      version: DaemonVersion.DAEMON_SERVER_VERSION,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      workspaceRoot: endpoint.workspaceRoot,
      socketPath: endpoint.socketPath,
      lockPath: endpoint.lockPath,
      tokenPath: endpoint.tokenPath,
      startedAt: lock.record.startedAt,
    };
    await writeFile(endpoint.metaPath, JSON.stringify(metadata), {
      encoding: 'utf8',
      mode: 0o600,
    });

    return { kernel: createdKernel, server: createdServer };
  } catch (error: unknown) {
    await rollbackStartup(endpoint, lock, kernel, server);
    throw error;
  }
}

export async function createDaemon(options: CreateDaemonOptions): Promise<RunningDaemon> {
  const endpoint = await resolveEndpoint(options.workspaceRoot);
  const lock = await acquireDaemonLock(endpoint, {
    pid: process.pid,
    version: DaemonVersion.DAEMON_SERVER_VERSION,
  });
  const token = randomBytes(32).toString('hex');
  const runtime = await startRuntime(endpoint, lock, token, options);

  try {
    const idleMonitor = new IdleMonitor({
      ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
      onIdleShutdown: () => shutdownCoordinator.shutdown(),
    });

    const unsubscribeActivity = runtime.server.onActivity((snapshot) => {
      idleMonitor.update(snapshot.activeConnections, snapshot.inFlightRequests);
    });

    const shutdownCoordinator = new GracefulShutdownCoordinator({
      server: runtime.server,
      kernel: runtime.kernel,
      endpoint,
      beforeTeardown: () => {
        unsubscribeActivity();
        idleMonitor.dispose();
      },
    });

    idleMonitor.update(runtime.server.connectionCount, runtime.server.inFlightCount);

    return {
      endpoint,
      token,
      lock,
      kernel: runtime.kernel,
      server: runtime.server,
      idleMonitor,
      isShuttingDown: () => shutdownCoordinator.isShuttingDown,
      shutdown: () => shutdownCoordinator.shutdown(),
    };
  } catch (error: unknown) {
    await rollbackStartup(endpoint, lock, runtime.kernel, runtime.server);
    throw error;
  }
}
