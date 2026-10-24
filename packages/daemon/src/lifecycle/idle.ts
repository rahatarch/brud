export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export const MINIMUM_IDLE_TIMEOUT_MS = 5_000;

export interface IdleTimerHandle {
  unref?: () => void;
}

export interface IdleTimerScheduler {
  setTimeout(callback: () => void, delayMs: number): IdleTimerHandle;
  clearTimeout(handle: IdleTimerHandle): void;
}

const defaultScheduler: IdleTimerScheduler = {
  setTimeout: (callback: () => void, delayMs: number): IdleTimerHandle =>
    setTimeout(callback, delayMs),
  clearTimeout: (handle: IdleTimerHandle): void => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export interface IdleMonitorOptions {
  readonly idleTimeoutMs?: number;
  readonly onIdleShutdown: () => void | Promise<void>;
  readonly scheduler?: IdleTimerScheduler;
  readonly minimumIdleTimeoutMs?: number;
}

function clampTimeout(requested: number | undefined, minimum: number): number {
  if (requested === undefined) {
    return Math.max(DEFAULT_IDLE_TIMEOUT_MS, minimum);
  }

  if (!Number.isFinite(requested) || requested <= 0) {
    throw new RangeError('idleTimeoutMs must be a positive finite number');
  }

  return Math.max(Math.trunc(requested), minimum);
}

export class IdleMonitor {
  readonly idleTimeoutMs: number;

  private readonly onIdleShutdown: () => void | Promise<void>;

  private readonly scheduler: IdleTimerScheduler;

  private timer: IdleTimerHandle | undefined;

  private disposed = false;

  constructor(options: IdleMonitorOptions) {
    this.idleTimeoutMs = clampTimeout(
      options.idleTimeoutMs,
      options.minimumIdleTimeoutMs ?? MINIMUM_IDLE_TIMEOUT_MS,
    );
    this.onIdleShutdown = options.onIdleShutdown;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  get isArmed(): boolean {
    return this.timer !== undefined;
  }

  update(activeConnections: number, inFlightRequests: number): void {
    if (this.disposed) {
      return;
    }

    if (activeConnections > 0 || inFlightRequests > 0) {
      this.disarm();
      return;
    }

    this.arm();
  }

  dispose(): void {
    this.disposed = true;
    this.disarm();
  }

  private arm(): void {
    if (this.timer !== undefined) {
      return;
    }

    const timer = this.scheduler.setTimeout(() => {
      this.timer = undefined;
      void this.onIdleShutdown();
    }, this.idleTimeoutMs);

    timer.unref?.();
    this.timer = timer;
  }

  private disarm(): void {
    if (this.timer === undefined) {
      return;
    }

    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
