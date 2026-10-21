import { createServer as createNetServer } from 'node:net';

export type McpServerPhase = 'stopped' | 'starting' | 'running' | 'stopping';

export interface McpServerStatus {
  readonly phase: McpServerPhase;
  readonly workspaceRoot?: string;
  readonly url?: string;
  readonly port?: number;
  readonly error?: string;
}

export interface McpServerHandle {
  readonly url: string;
  readonly port: number;
  readonly workspaceRoot: string;
  readonly refreshSettings?: () => void;
  close(): Promise<void>;
}

export interface McpStartOptions {
  readonly preferredPort?: number;
}

export interface McpServerServiceOptions {
  readonly startServer: (
    workspaceRoot: string,
    options?: McpStartOptions,
  ) => Promise<McpServerHandle>;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly log?: (message: string) => void;
  readonly preferredPort?: number;
  readonly claimRetryMs?: number;
  readonly isPortAvailable?: (port: number) => Promise<boolean>;
}

export interface Disposable {
  dispose(): void;
}

export class McpServerService {
  private phase: McpServerPhase = 'stopped';
  private handle: McpServerHandle | undefined;
  private error: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(status: McpServerStatus) => void>();
  private claimTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: McpServerServiceOptions) {}

  getStatus(): McpServerStatus {
    if (this.phase === 'running' && this.handle) {
      return {
        phase: this.phase,
        workspaceRoot: this.handle.workspaceRoot,
        url: this.handle.url,
        port: this.handle.port,
      };
    }
    if (this.phase === 'stopped' && this.error) {
      return { phase: this.phase, error: this.error };
    }
    return { phase: this.phase };
  }

  onDidChange(listener: (status: McpServerStatus) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  start(): Promise<McpServerStatus> {
    return this.enqueue(() => this.startInternal());
  }

  stop(): Promise<McpServerStatus> {
    return this.enqueue(() => this.stopInternal());
  }

  restart(): Promise<McpServerStatus> {
    return this.enqueue(async () => {
      await this.stopInternal();
      return this.startInternal();
    });
  }

  sync(autoStart: boolean): Promise<McpServerStatus> {
    return this.enqueue(async () => {
      const nextRoot = this.options.getWorkspaceRoot();

      if (this.phase === 'running' && this.handle) {
        if (nextRoot && nextRoot === this.handle.workspaceRoot) {
          return this.getStatus();
        }
        await this.stopInternal();
        return this.startInternal();
      }

      if (autoStart && this.phase === 'stopped') {
        return this.startInternal();
      }

      return this.getStatus();
    });
  }

  reanchor(): Promise<McpServerStatus> {
    return this.sync(false);
  }

  refreshSettings(): void {
    this.handle?.refreshSettings?.();
  }

  dispose(): Promise<McpServerStatus> {
    return this.enqueue(() => this.stopInternal());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async startInternal(): Promise<McpServerStatus> {
    if (this.phase === 'running') {
      return this.getStatus();
    }

    const workspaceRoot = this.options.getWorkspaceRoot();
    if (!workspaceRoot) {
      this.phase = 'stopped';
      this.error = 'No project folder is open.';
      this.emit();
      return this.getStatus();
    }

    this.phase = 'starting';
    this.error = undefined;
    this.emit();

    try {
      const handle = await this.startWithPreferredPort(workspaceRoot);
      this.handle = handle;
      this.phase = 'running';
      this.options.log?.(`MCP server listening on ${handle.url} (root: ${handle.workspaceRoot})`);
      if (this.options.preferredPort !== undefined && handle.port !== this.options.preferredPort) {
        this.options.log?.(
          `Preferred port ${this.options.preferredPort} is held elsewhere; retrying in the background`,
        );
        this.scheduleClaim();
      }
      this.emit();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      this.handle = undefined;
      this.phase = 'stopped';
      this.error = message;
      this.options.log?.(`MCP server failed to start: ${message}`);
      this.emit();
    }

    return this.getStatus();
  }

  private async startWithPreferredPort(workspaceRoot: string): Promise<McpServerHandle> {
    const preferred = this.options.preferredPort;
    if (preferred !== undefined) {
      try {
        return await this.options.startServer(workspaceRoot, { preferredPort: preferred });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== 'EADDRINUSE') {
          throw error;
        }
        this.options.log?.(
          `Preferred port ${preferred} is in use; falling back to an ephemeral port`,
        );
      }
    }
    return this.options.startServer(workspaceRoot);
  }

  private scheduleClaim(): void {
    if (this.claimTimer !== null || this.options.preferredPort === undefined) {
      return;
    }
    const interval = this.options.claimRetryMs ?? 30_000;
    this.claimTimer = setInterval(() => {
      void this.claimPreferredPort();
    }, interval);
    this.claimTimer.unref?.();
  }

  private clearClaim(): void {
    if (this.claimTimer !== null) {
      clearInterval(this.claimTimer);
      this.claimTimer = null;
    }
  }

  private async claimPreferredPort(): Promise<void> {
    const preferred = this.options.preferredPort;
    if (
      preferred === undefined ||
      this.phase !== 'running' ||
      !this.handle ||
      this.handle.port === preferred
    ) {
      this.clearClaim();
      return;
    }

    const probe = this.options.isPortAvailable ?? defaultIsPortAvailable;
    if (!(await probe(preferred))) {
      return;
    }

    await this.enqueue(async () => {
      if (
        this.options.preferredPort === undefined ||
        this.phase !== 'running' ||
        !this.handle ||
        this.handle.port === this.options.preferredPort
      ) {
        return;
      }

      const root = this.handle.workspaceRoot;
      let next: McpServerHandle;
      try {
        next = await this.options.startServer(root, {
          preferredPort: this.options.preferredPort,
        });
      } catch {
        return;
      }

      const previous = this.handle;
      this.handle = next;
      this.options.log?.(`MCP server acquired preferred port: ${next.url}`);
      this.emit();
      await previous.close().catch(() => undefined);
      this.clearClaim();
    });
  }

  private async stopInternal(): Promise<McpServerStatus> {
    if (this.phase === 'stopped' && !this.handle) {
      return this.getStatus();
    }

    this.clearClaim();
    this.phase = 'stopping';
    this.emit();

    const handle = this.handle;
    this.handle = undefined;
    if (handle) {
      try {
        await handle.close();
        this.options.log?.(`MCP server stopped (was ${handle.url})`);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        this.error = message;
        this.options.log?.(`MCP server failed to stop cleanly: ${message}`);
      }
    }

    this.phase = 'stopped';
    this.emit();
    return this.getStatus();
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

async function defaultIsPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}
