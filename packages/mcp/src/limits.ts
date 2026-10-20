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

export type ExecutionAbortReason = 'timeout' | 'cancelled';

export class ExecutionAbortedError extends Error {
  constructor(readonly reason: ExecutionAbortReason) {
    super(reason === 'timeout' ? 'The operation exceeded its time limit.' : 'The operation was cancelled.');
    this.name = 'ExecutionAbortedError';
  }
}

function abortedPromise(signal: AbortSignal, timeoutSignal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      reject(new ExecutionAbortedError(timeoutSignal?.aborted ? 'timeout' : 'cancelled'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withTimeout<T>(
  timeoutMs: number | undefined,
  outer: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  onSettled?: () => void,
): Promise<T> {
  const timeoutController = new AbortController();
  const timer =
    timeoutMs && timeoutMs > 0 ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined;
  const signal = outer ? AbortSignal.any([outer, timeoutController.signal]) : timeoutController.signal;

  const execution = run(signal);
  if (onSettled) {
    void execution.then(onSettled, onSettled);
  }

  try {
    return await Promise.race([execution, abortedPromise(signal, timeoutController.signal)]);
  } catch (error) {
    execution.catch(() => undefined);
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
