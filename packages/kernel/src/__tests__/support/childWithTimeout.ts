import type { ChildProcess } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resolves with the first chunk written to the child's stdout.
 *
 * Rejects if the child emits `error` or does not write within `timeoutMs`, so a
 * stalled child fails the test instead of hanging the suite.
 *
 * @param child - Child process spawned with a piped stdout.
 * @param timeoutMs - Deadline in milliseconds.
 */
export function waitForChildData(child: ChildProcess, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdout = child.stdout;
    if (stdout === null) {
      reject(new Error('waitForChildData: child has no stdout pipe'));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`waitForChildData: child produced no stdout data within ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (chunk: Buffer | string): void => {
      cleanup();
      resolve(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      stdout.off('data', onData);
      child.off('error', onError);
    };

    stdout.once('data', onData);
    child.once('error', onError);
  });
}

/**
 * Resolves with the child's exit code when it closes.
 *
 * Rejects if the child emits `error` or does not close within `timeoutMs`, so a
 * stalled child fails the test instead of hanging the suite.
 *
 * @param child - Child process to await.
 * @param timeoutMs - Deadline in milliseconds.
 */
export function waitForChildClose(child: ChildProcess, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`waitForChildClose: child did not close within ${timeoutMs}ms`));
    }, timeoutMs);

    const onClose = (code: number | null): void => {
      cleanup();
      resolve(code);
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('error', onError);
    };

    child.once('close', onClose);
    child.once('error', onError);
  });
}