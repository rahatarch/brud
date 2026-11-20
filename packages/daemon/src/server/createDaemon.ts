import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import * as Protocol from '@brud/protocol';
import { IdleMonitor } from '../lifecycle/idle.js';
import { acquireDaemonLock } from '../lifecycle/lock.js';
import type { LockHandle } from '../lifecycle/lock.js';
import { resolveEndpoint } from '../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import { GracefulShutdownCoordinator } from '../lifecycle/shutdown.js';
import { KernelInstanceRegistry } from '../instanceRegistry.js';
import { loadOperatorConfig } from '../operatorConfig.js';
import type { DaemonOperatorConfig } from '../operatorConfig.js';
import { DaemonServer } from './DaemonServer.js';
import * as DaemonVersion from '../version.js';

export interface CreateDaemonOptions {
  /**
   * Daemon home: the operator's state folder. It names the endpoint, holds
   * kernel state, and by default holds the operator config (`daemon.json`).
   */
  readonly home: string;
  /** Operator config; defaults to `<home>/daemon.json`. */
  readonly operator?: DaemonOperatorConfig;
  /** Explicit operator config path (ignored when `operator` is given). */
  readonly operatorConfigPath?: string;
  /** Daemon idle shutdown window. */
  readonly idleTimeoutMs?: number;
  /** Idle window for a kernel instance with no clients; 0 disables. */
  readonly instanceIdleTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly maxInFlightPerConnection?: number;
  readonly requestTimeoutMs?: number;
  readonly expectedPeerPid?: number;
}

export interface DaemonMetadataRecord {
  readonly pid: number;
  readonly version: string;
  readonly protocolVersion: string;
  readonly home: string;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly tokenPath: string;
  readonly aiTokenPath: string;
  readonly startedAt: number;
}

export interface RunningDaemon {
  readonly endpoint: DaemonEndpoint;
  readonly token: string;
  readonly tokens: Readonly<Record<'ui' | 'ai', string>>;
  readonly lock: LockHandle;
  readonly registry: KernelInstanceRegistry;
  readonly server: DaemonServer;
  readonly idleMonitor: IdleMonitor;
  readonly isShuttingDown: () => boolean;
  readonly shutdown: () => Promise<void>;
}

function writeDaemonWarning(message: string, meta?: Record<string, unknown>): void {
  process.stderr.write(`${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}\n`);
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
  registry: KernelInstanceRegistry | undefined,
  server: DaemonServer | undefined,
): Promise<void> {
  if (server !== undefined) {
    await server.close().catch(() => undefined);
  }

  if (registry !== undefined) {
    await registry.disposeAll().catch(() => undefined);
  }

  await unlinkIfPresent(endpoint.tokenPath).catch(() => undefined);
  await unlinkIfPresent(endpoint.aiTokenPath).catch(() => undefined);
  await unlinkIfPresent(endpoint.metaPath).catch(() => undefined);
  await lock.release().catch(() => undefined);
}

/**
 * Starts the daemon: a neutral host that boots kernels from the operator's
 * composition on request. No kernel is booted at start.
 */
export async function createDaemon(options: CreateDaemonOptions): Promise<RunningDaemon> {
  const endpoint = await resolveEndpoint(options.home);
  const operator = options.operator ?? loadOperatorConfig(endpoint.home, options.operatorConfigPath);
  const lock = await acquireDaemonLock(endpoint, {
    pid: process.pid,
    version: DaemonVersion.DAEMON_SERVER_VERSION,
  });
  const tokens = {
    ui: randomBytes(32).toString('hex'),
    ai: randomBytes(32).toString('hex'),
  } as const;
  let registry: KernelInstanceRegistry | undefined;
  let server: DaemonServer | undefined;

  try {
    await writeFile(endpoint.tokenPath, tokens.ui, { encoding: 'utf8', mode: 0o600 });
    await writeFile(endpoint.aiTokenPath, tokens.ai, { encoding: 'utf8', mode: 0o600 });

    registry = new KernelInstanceRegistry({
      home: endpoint.home,
      operator,
      ...(options.instanceIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.instanceIdleTimeoutMs }),
      logger: { warn: writeDaemonWarning },
    });
    server = await DaemonServer.create({
      registry,
      socketPath: endpoint.socketPath,
      principals: tokens,
      home: endpoint.home,
      ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
      ...(options.maxInFlightPerConnection === undefined ? {} : { maxInFlightPerConnection: options.maxInFlightPerConnection }),
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.expectedPeerPid === undefined ? {} : { expectedPeerPid: options.expectedPeerPid }),
    });
    await server.listen();

    const metadata: DaemonMetadataRecord = {
      pid: process.pid,
      version: DaemonVersion.DAEMON_SERVER_VERSION,
      protocolVersion: Protocol.DAEMON_PROTOCOL_VERSION,
      home: endpoint.home,
      socketPath: endpoint.socketPath,
      lockPath: endpoint.lockPath,
      tokenPath: endpoint.tokenPath,
      aiTokenPath: endpoint.aiTokenPath,
      startedAt: lock.record.startedAt,
    };

    await writeFile(endpoint.metaPath, JSON.stringify(metadata), { encoding: 'utf8', mode: 0o600 });
  } catch (error: unknown) {
    await rollbackStartup(endpoint, lock, registry, server);
    throw error;
  }

  const runningRegistry = registry;
  const runningServer = server;
  const idleMonitor = new IdleMonitor({
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    onIdleShutdown: () => shutdownCoordinator.shutdown(),
  });
  const unsubscribeActivity = runningServer.onActivity((snapshot) => {
    idleMonitor.update(snapshot.activeConnections, snapshot.inFlightRequests);
  });
  const shutdownCoordinator = new GracefulShutdownCoordinator({
    server: runningServer,
    disposeKernels: () => runningRegistry.disposeAll(),
    endpoint,
    beforeTeardown: () => {
      unsubscribeActivity();
      idleMonitor.dispose();
    },
  });

  idleMonitor.update(runningServer.connectionCount, runningServer.inFlightCount);

  return {
    endpoint,
    token: tokens.ui,
    tokens,
    lock,
    registry: runningRegistry,
    server: runningServer,
    idleMonitor,
    isShuttingDown: () => shutdownCoordinator.isShuttingDown,
    shutdown: () => shutdownCoordinator.shutdown(),
  };
}
