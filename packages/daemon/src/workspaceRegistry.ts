import type {
  BrudKernel,
  IBrudPlugin,
  IMcpTransport,
  IStorageDriver,
} from '@brud/kernel' with { 'resolution-mode': 'import' };
import { createKernel } from './kernelRuntime.js';

/** Default idle window after which a client-less workspace is disposed. */
export const DEFAULT_WORKSPACE_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Default cadence of the idle sweep. */
export const DEFAULT_WORKSPACE_IDLE_CHECK_INTERVAL_MS = 60 * 1000;

/** One booted kernel attached to a workspace root. */
export interface KernelWorkspace {
  readonly root: string;
  readonly kernel: BrudKernel;
  readonly clients: Set<string>;
  lastUsedAt: Date;
}

/** Options passed to a custom kernel factory. */
export interface KernelFactoryOptions {
  readonly workspaceRoot: string;
  /** Explicit plugin override; omitted means the config's plugin set. */
  readonly initialPlugins?: readonly IBrudPlugin[];
  readonly storageDriver?: IStorageDriver;
  /** Certifies an explicit plugin override with the official brand. */
  readonly certifyInitialPlugins?: boolean;
}

/** Builds the kernel for a workspace; the returned kernel may already be booted. */
export type KernelFactory = (options: KernelFactoryOptions) => Promise<BrudKernel>;

/** Timer handle shape compatible with Node's `Timeout`. */
export interface WorkspaceRegistryTimerHandle {
  unref?: () => void;
}

/** Injectable timer surface used by the idle sweep. */
export interface WorkspaceRegistryScheduler {
  setTimeout(callback: () => void, delayMs: number): WorkspaceRegistryTimerHandle;
  clearTimeout(handle: WorkspaceRegistryTimerHandle): void;
}

const defaultScheduler: WorkspaceRegistryScheduler = {
  setTimeout: (callback: () => void, delayMs: number): WorkspaceRegistryTimerHandle =>
    setTimeout(callback, delayMs),
  clearTimeout: (handle: WorkspaceRegistryTimerHandle): void => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** Diagnostic sink used for non-fatal transport and idle failures. */
export interface WorkspaceRegistryLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** Construction options for {@link WorkspaceRegistry}. */
export interface WorkspaceRegistryOptions {
  /** Plugins registered into every spawned kernel. */
  readonly initialPlugins?: readonly IBrudPlugin[];

  /** Storage driver shared by every spawned kernel. */
  readonly storageDriver?: IStorageDriver;

  /** Certifies initial plugins with the kernel's official brand. */
  readonly certifyInitialPlugins?: boolean;

  /** Idle window after which client-less workspaces are disposed. */
  readonly idleTimeoutMs?: number;

  /** Cadence of the idle sweep. Defaults to one minute. */
  readonly idleCheckIntervalMs?: number;

  /** Kernel builder override. Intended for tests. */
  readonly kernelFactory?: KernelFactory;

  /** Timer override. Intended for tests. */
  readonly scheduler?: WorkspaceRegistryScheduler;

  /** Clock override. Intended for tests. */
  readonly now?: () => number;

  /**
   * Called after a workspace boots and before {@link spawn} resolves.
   *
   * The returned transports are owned by the registry and closed before the
   * kernel is shut down.
   */
  readonly onWorkspaceSpawned?: (
    workspace: KernelWorkspace,
  ) => Promise<readonly IMcpTransport[]>;

  /** Diagnostic sink for transport and shutdown failures. */
  readonly logger?: WorkspaceRegistryLogger;
}

async function defaultKernelFactory(options: KernelFactoryOptions): Promise<BrudKernel> {
  return createKernel({
    workspaceRoot: options.workspaceRoot,
    ...(options.storageDriver === undefined ? {} : { storageDriver: options.storageDriver }),
    ...(options.initialPlugins === undefined ? {} : { initialPlugins: options.initialPlugins }),
    ...(options.certifyInitialPlugins === undefined
      ? {}
      : { certifyInitialPlugins: options.certifyInitialPlugins }),
  });
}

function normalizeIdleTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_WORKSPACE_IDLE_TIMEOUT_MS;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('idleTimeoutMs must be a non-negative finite number');
  }

  return Math.trunc(value);
}

/**
 * Registry of booted kernels keyed by canonical workspace root.
 *
 * One daemon can serve several workspaces. Each entry owns an independent
 * kernel, its own tool registry, and its own client set. Workspaces with no
 * attached clients are disposed after the configured idle window; disposal
 * closes host transports first and then shuts the kernel down.
 */
export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, KernelWorkspace>();

  private readonly transports = new Map<string, readonly IMcpTransport[]>();

  private readonly pendingSpawns = new Map<string, Promise<KernelWorkspace>>();

  private readonly initialPlugins: readonly IBrudPlugin[] | undefined;

  private readonly storageDriver: IStorageDriver | undefined;

  private readonly certifyInitialPlugins: boolean | undefined;

  private readonly kernelFactory: KernelFactory;

  private readonly onWorkspaceSpawned:
    | ((workspace: KernelWorkspace) => Promise<readonly IMcpTransport[]>)
    | undefined;

  private readonly logger: WorkspaceRegistryLogger | undefined;

  private readonly scheduler: WorkspaceRegistryScheduler;

  private readonly now: () => number;

  private readonly idleTimeoutMs: number;

  private readonly idleCheckIntervalMs: number;

  private sweepTimer: WorkspaceRegistryTimerHandle | undefined;

  private disposed = false;

  constructor(options: WorkspaceRegistryOptions = {}) {
    this.initialPlugins = options.initialPlugins;
    this.storageDriver = options.storageDriver;
    this.certifyInitialPlugins = options.certifyInitialPlugins;
    this.kernelFactory = options.kernelFactory ?? defaultKernelFactory;
    this.onWorkspaceSpawned = options.onWorkspaceSpawned;
    this.logger = options.logger;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.now = options.now ?? Date.now;
    this.idleTimeoutMs = normalizeIdleTimeout(options.idleTimeoutMs);
    this.idleCheckIntervalMs = Math.max(
      1,
      Math.trunc(options.idleCheckIntervalMs ?? DEFAULT_WORKSPACE_IDLE_CHECK_INTERVAL_MS),
    );

    this.scheduleSweep();
  }

  /** Returns the workspace entry for a root, or `undefined`. */
  get(root: string): KernelWorkspace | undefined {
    return this.workspaces.get(root);
  }

  /** Every live workspace, in spawn order. */
  list(): readonly KernelWorkspace[] {
    return [...this.workspaces.values()];
  }

  /**
   * Spawns and boots a kernel for a root.
   *
   * Idempotent: an existing workspace or an in-flight spawn for the same root
   * is returned instead of booting a second kernel.
   */
  async spawn(
    root: string,
    initialPlugins?: readonly IBrudPlugin[],
  ): Promise<KernelWorkspace> {
    if (this.disposed) {
      throw new Error('Workspace registry has been disposed');
    }

    const existing = this.workspaces.get(root);

    if (existing !== undefined) {
      existing.lastUsedAt = new Date(this.now());

      return existing;
    }

    const pending = this.pendingSpawns.get(root);

    if (pending !== undefined) {
      return pending;
    }

    const creation = this.createWorkspace(root, initialPlugins ?? this.initialPlugins);
    this.pendingSpawns.set(root, creation);

    try {
      return await creation;
    } finally {
      this.pendingSpawns.delete(root);
    }
  }

  /** Attaches a client to a live workspace. */
  attachClient(root: string, clientId: string): void {
    const workspace = this.workspaces.get(root);

    if (workspace === undefined) {
      throw new Error(`Workspace "${root}" is not registered`);
    }

    workspace.clients.add(clientId);
    workspace.lastUsedAt = new Date(this.now());
  }

  /** Removes a client from whichever workspace holds it. */
  detachClient(clientId: string): void {
    for (const workspace of this.workspaces.values()) {
      if (!workspace.clients.delete(clientId)) {
        continue;
      }

      workspace.lastUsedAt = new Date(this.now());

      return;
    }
  }

  /** Closes host transports and shuts the kernel down. */
  async dispose(root: string): Promise<void> {
    const workspace = this.workspaces.get(root);

    if (workspace === undefined) {
      return;
    }

    this.workspaces.delete(root);

    const transports = this.transports.get(root) ?? [];
    this.transports.delete(root);

    for (const transport of transports) {
      try {
        await transport.close();
      } catch (error: unknown) {
        this.logger?.warn('Workspace transport close failed', {
          root,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (workspace.kernel.lifecycleState === 'RUNNING') {
      await workspace.kernel.shutdown();
    }
  }

  /** Disposes every workspace that has had no clients for `idleMs`. */
  async disposeIdle(idleMs: number = this.idleTimeoutMs): Promise<void> {
    const cutoff = this.now() - idleMs;
    const idle: string[] = [];

    for (const workspace of this.workspaces.values()) {
      if (workspace.clients.size === 0 && workspace.lastUsedAt.getTime() <= cutoff) {
        idle.push(workspace.root);
      }
    }

    for (const root of idle) {
      try {
        await this.dispose(root);
      } catch (error: unknown) {
        this.logger?.warn('Workspace idle disposal failed', {
          root,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Disposes every workspace and stops the idle sweep. */
  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.sweepTimer !== undefined) {
      this.scheduler.clearTimeout(this.sweepTimer);
      this.sweepTimer = undefined;
    }

    const roots = [...this.workspaces.keys()];
    let firstError: unknown;

    for (const root of roots) {
      try {
        await this.dispose(root);
      } catch (error: unknown) {
        firstError ??= error;
      }
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  /**
   * Adopts an already-booted kernel.
   *
   * Used by `DaemonServer` compositions that still supply a pre-booted kernel
   * directly. The caller owns boot; the registry owns shutdown.
   */
  adopt(root: string, kernel: BrudKernel): KernelWorkspace {
    const existing = this.workspaces.get(root);

    if (existing !== undefined) {
      return existing;
    }

    const workspace: KernelWorkspace = {
      root,
      kernel,
      clients: new Set<string>(),
      lastUsedAt: new Date(this.now()),
    };

    this.workspaces.set(root, workspace);

    return workspace;
  }

  private async createWorkspace(
    root: string,
    initialPlugins: readonly IBrudPlugin[] | undefined,
  ): Promise<KernelWorkspace> {
    const kernel = await this.kernelFactory({
      workspaceRoot: root,
      initialPlugins,
      ...(this.storageDriver === undefined ? {} : { storageDriver: this.storageDriver }),
      ...(this.certifyInitialPlugins === undefined
        ? {}
        : { certifyInitialPlugins: this.certifyInitialPlugins }),
    });

    if (kernel.lifecycleState === 'UNINITIALIZED') {
      await kernel.boot({ options: { workspaceRoot: root } });
    }

    const workspace: KernelWorkspace = {
      root,
      kernel,
      clients: new Set<string>(),
      lastUsedAt: new Date(this.now()),
    };

    this.workspaces.set(root, workspace);

    if (this.onWorkspaceSpawned !== undefined) {
      try {
        const transports = await this.onWorkspaceSpawned(workspace);
        this.transports.set(root, transports);
      } catch (error: unknown) {
        this.logger?.warn('Workspace transport attachment failed', {
          root,
          error: error instanceof Error ? error.message : String(error),
        });
        this.transports.set(root, []);
      }
    }

    return workspace;
  }

  private scheduleSweep(): void {
    if (this.disposed || this.idleTimeoutMs === 0) {
      return;
    }

    const handle = this.scheduler.setTimeout(() => {
      this.sweepTimer = undefined;

      void this.disposeIdle()
        .catch((error: unknown) => {
          this.logger?.warn('Workspace idle sweep failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.scheduleSweep();
        });
    }, this.idleCheckIntervalMs);

    handle.unref?.();
    this.sweepTimer = handle;
  }
}