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
  close(): Promise<void>;
}

export interface McpServerServiceOptions {
  readonly startServer: (workspaceRoot: string) => Promise<McpServerHandle>;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly log?: (message: string) => void;
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

  reanchor(): Promise<McpServerStatus> {
    return this.enqueue(async () => {
      const nextRoot = this.options.getWorkspaceRoot();
      if (this.phase !== 'running' || !this.handle) {
        return this.getStatus();
      }
      if (nextRoot && nextRoot === this.handle.workspaceRoot) {
        return this.getStatus();
      }
      await this.stopInternal();
      return this.startInternal();
    });
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
      const handle = await this.options.startServer(workspaceRoot);
      this.handle = handle;
      this.phase = 'running';
      this.options.log?.(`MCP server listening on ${handle.url} (root: ${handle.workspaceRoot})`);
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

  private async stopInternal(): Promise<McpServerStatus> {
    if (this.phase === 'stopped' && !this.handle) {
      return this.getStatus();
    }

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
