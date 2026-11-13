import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { IStorageDriver } from '@brud/service-filesystem' with { 'resolution-mode': 'import' };
import * as Protocol from '@brud/protocol';
import { IdleMonitor } from '../lifecycle/idle.js';
import { acquireDaemonLock } from '../lifecycle/lock.js';
import type { LockHandle } from '../lifecycle/lock.js';
import { canonicalizeDaemonWorkspaceRoot, resolveEndpoint } from '../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import { GracefulShutdownCoordinator } from '../lifecycle/shutdown.js';
import { attachMcpTransports } from '../mcpTransport.js';
import { WorkspaceRegistry } from '../workspaceRegistry.js';
import type { KernelWorkspace } from '../workspaceRegistry.js';
import { DaemonServer } from './DaemonServer.js';
import * as DaemonVersion from '../version.js';

export interface CreateDaemonOptions {
  readonly workspaceRoot: string;
  /** Shuts the daemon process down after this much transport idleness. */
  readonly idleTimeoutMs?: number;
  /** Disposes client-less workspace kernels after this window. */
  readonly workspaceIdleTimeoutMs?: number;
  /**
   * Binds `process.stdin`/`process.stdout` as the transport for plugins that
   * declare `transports: ['stdio']` and skips the Unix-domain socket listener.
   */
  readonly stdio?: boolean;
  readonly storageDriver?: IStorageDriver;
  /** Ceiling on simultaneously open connections. */
  readonly maxConnections?: number;
  /** Ceiling on concurrent in-flight requests per connection. */
  readonly maxInFlightPerConnection?: number;
  /** Server-side deadline for one request. */
  readonly requestTimeoutMs?: number;
  /**
   * Process allowed to connect over the socket. Defaults to the current
   * process, which is the host when the daemon is embedded in it.
   */
  readonly expectedPeerPid?: number;
}

export interface DaemonMetadataRecord {
  readonly pid: number;
  readonly version: string;
  readonly protocolVersion: string;
  readonly workspaceRoot: string;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly tokenPath: string;
  readonly aiTokenPath: string;
  readonly startedAt: number;
}

export interface RunningDaemon {
  readonly endpoint: DaemonEndpoint;
  /** UI-principal pre-shared key (legacy single-token field). */
  readonly token: string;
  readonly tokens: Readonly<Record<'ui' | 'ai', string>>;
  readonly lock: LockHandle;
  /** Primary workspace kernel, kept for single-workspace callers. */
  readonly kernel: BrudKernel;
  readonly registry: WorkspaceRegistry;
  readonly primaryWorkspace: KernelWorkspace;
  readonly server: DaemonServer;
  readonly idleMonitor: IdleMonitor;
  readonly isShuttingDown: () => boolean;
  readonly shutdown: () => Promise<void>;
}

interface DaemonRuntime {
  readonly registry: WorkspaceRegistry;
  readonly workspace: KernelWorkspace;
  readonly server: DaemonServer;
}

/**
 * A daemon bound to the host process's stdio streams.
 *
 * There is no socket, lock, token, or metadata record: the lifetime of the
 * kernel is the lifetime of the stdio client. `clientClosed` resolves when the
 * client closes the input stream.
 */
export interface RunningStdioDaemon {
  readonly workspaceRoot: string;
  readonly kernel: BrudKernel;
  readonly registry: WorkspaceRegistry;
  readonly primaryWorkspace: KernelWorkspace;
  readonly clientClosed: Promise<void>;
  readonly isShuttingDown: () => boolean;
  readonly shutdown: () => Promise<void>;
}

function writeDaemonWarning(message: string, meta?: Record<string, unknown>): void {
  process.stderr.write(
    `${message}${meta === undefined ? '' : ` ${JSON.stringify(meta)}`}\n`,
  );
}

function createWorkspaceRegistry(
  options: CreateDaemonOptions,
  stdio: boolean,
): WorkspaceRegistry {
  return new WorkspaceRegistry({
    ...(options.storageDriver === undefined ? {} : { storageDriver: options.storageDriver }),
    // A stdio daemon serves exactly one client for its whole process
    // lifetime, so its workspace must never be reclaimed by the idle sweep.
    ...(stdio
      ? { idleTimeoutMs: 0 }
      : options.workspaceIdleTimeoutMs === undefined
        ? {}
        : { idleTimeoutMs: options.workspaceIdleTimeoutMs }),
    onWorkspaceSpawned: (workspace) =>
      attachMcpTransports(workspace, {
        stdio,
        logger: { warn: writeDaemonWarning },
      }),
    logger: { warn: writeDaemonWarning },
  });
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
  registry: WorkspaceRegistry | undefined,
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

async function startRuntime(
  endpoint: DaemonEndpoint,
  lock: LockHandle,
  tokens: Readonly<Record<'ui' | 'ai', string>>,
  options: CreateDaemonOptions,
): Promise<DaemonRuntime> {
  let registry: WorkspaceRegistry | undefined;
  let server: DaemonServer | undefined;

  try {
    await writeFile(endpoint.tokenPath, tokens.ui, { encoding: 'utf8', mode: 0o600 });
    await writeFile(endpoint.aiTokenPath, tokens.ai, { encoding: 'utf8', mode: 0o600 });

    const createdRegistry = createWorkspaceRegistry(options, false);
    registry = createdRegistry;

    const workspace = await createdRegistry.spawn(endpoint.workspaceRoot);

    const createdServer = await DaemonServer.create({
      registry: createdRegistry,
      socketPath: endpoint.socketPath,
      principals: tokens,
      workspaceRoot: endpoint.workspaceRoot,
      enforcePrimaryRoot: true,
      ...(options.maxConnections === undefined
        ? {}
        : { maxConnections: options.maxConnections }),
      ...(options.maxInFlightPerConnection === undefined
        ? {}
        : { maxInFlightPerConnection: options.maxInFlightPerConnection }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.expectedPeerPid === undefined
        ? {}
        : { expectedPeerPid: options.expectedPeerPid }),
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
      aiTokenPath: endpoint.aiTokenPath,
      startedAt: lock.record.startedAt,
    };
    await writeFile(endpoint.metaPath, JSON.stringify(metadata), {
      encoding: 'utf8',
      mode: 0o600,
    });

    return { registry: createdRegistry, workspace, server: createdServer };
  } catch (error: unknown) {
    await rollbackStartup(endpoint, lock, registry, server);
    throw error;
  }
}

/**
 * Boots a daemon whose only transport is the host process's stdio.
 *
 * No Unix-domain socket is bound and no runtime artifacts are written. The
 * workspace registry spawns one kernel, and `attachMcpTransports` hands the
 * MCP bridge plugin a {@link StdioMcpTransport} reading from `process.stdin`
 * and writing to `process.stdout`. Diagnostics go to stderr so the stdout
 * stream stays a clean newline-delimited JSON-RPC channel.
 */
export async function createStdioDaemon(
  options: CreateDaemonOptions,
): Promise<RunningStdioDaemon> {
  const workspaceRoot = await canonicalizeDaemonWorkspaceRoot(options.workspaceRoot);
  const registry = createWorkspaceRegistry(options, true);

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= registry.disposeAll();
    return shutdownPromise;
  };

  const clientClosed = new Promise<void>((resolve) => {
    const finish = (): void => resolve();
    process.stdin.once('end', finish);
    process.stdin.once('close', finish);
  });

  try {
    const workspace = await registry.spawn(workspaceRoot);

    return {
      workspaceRoot,
      kernel: workspace.kernel,
      registry,
      primaryWorkspace: workspace,
      clientClosed,
      isShuttingDown: () => shutdownPromise !== undefined,
      shutdown,
    };
  } catch (error: unknown) {
    await registry.disposeAll().catch(() => undefined);
    throw error;
  }
}

export function createDaemon(
  options: CreateDaemonOptions & { readonly stdio: true },
): Promise<RunningStdioDaemon>;
export function createDaemon(options: CreateDaemonOptions): Promise<RunningDaemon>;
export async function createDaemon(
  options: CreateDaemonOptions,
): Promise<RunningDaemon | RunningStdioDaemon> {
  if (options.stdio === true) {
    return createStdioDaemon(options);
  }

  const endpoint = await resolveEndpoint(options.workspaceRoot);
  const lock = await acquireDaemonLock(endpoint, {
    pid: process.pid,
    version: DaemonVersion.DAEMON_SERVER_VERSION,
  });
  const tokens = {
    ui: randomBytes(32).toString('hex'),
    ai: randomBytes(32).toString('hex'),
  } as const;
  const runtime = await startRuntime(endpoint, lock, tokens, options);

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
      kernel: runtime.workspace.kernel,
      disposeKernels: () => runtime.registry.disposeAll(),
      endpoint,
      beforeTeardown: () => {
        unsubscribeActivity();
        idleMonitor.dispose();
      },
    });

    idleMonitor.update(runtime.server.connectionCount, runtime.server.inFlightCount);

    return {
      endpoint,
      token: tokens.ui,
      tokens,
      lock,
      kernel: runtime.workspace.kernel,
      registry: runtime.registry,
      primaryWorkspace: runtime.workspace,
      server: runtime.server,
      idleMonitor,
      isShuttingDown: () => shutdownCoordinator.isShuttingDown,
      shutdown: () => shutdownCoordinator.shutdown(),
    };
  } catch (error: unknown) {
    await rollbackStartup(endpoint, lock, runtime.registry, runtime.server);
    throw error;
  }
}
