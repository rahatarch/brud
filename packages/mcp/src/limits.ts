export interface ConcurrencyLimiter {
  tryAcquire(): boolean;
  release(): void;
  readonly activeCount: number;
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 1;
  let active = 0;

  return {
    tryAcquire(): boolean {
      if (active >= limit) {
        return false;
      }
      active += 1;
      return true;
    },
    release(): void {
      active = Math.max(0, active - 1);
    },
    get activeCount(): number {
      return active;
    },
  };
}

export async function withTimeout<T>(
  timeoutMs: number | undefined,
  outer: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return run(outer ?? new AbortController().signal);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = outer ? AbortSignal.any([outer, controller.signal]) : controller.signal;
    return await run(signal);
  } finally {
    clearTimeout(timer);
  }
}
