import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createConcurrencyLimiter, withTimeout } from '../limits';

describe('concurrency limiter', () => {
  it('admits up to the limit and refuses the next request', () => {
    const limiter = createConcurrencyLimiter(2);
    assert.strictEqual(limiter.tryAcquire(), true);
    assert.strictEqual(limiter.tryAcquire(), true);
    assert.strictEqual(limiter.tryAcquire(), false);
    assert.strictEqual(limiter.activeCount, 2);
  });

  it('frees a slot on release and never goes negative', () => {
    const limiter = createConcurrencyLimiter(1);
    limiter.release();
    assert.strictEqual(limiter.activeCount, 0);
    assert.strictEqual(limiter.tryAcquire(), true);
    limiter.release();
    limiter.release();
    assert.strictEqual(limiter.activeCount, 0);
  });

  it('treats an invalid limit as a single slot', () => {
    const limiter = createConcurrencyLimiter(0);
    assert.strictEqual(limiter.tryAcquire(), true);
    assert.strictEqual(limiter.tryAcquire(), false);
  });
});

describe('execution timeout', () => {
  it('aborts a run that exceeds the timeout', async () => {
    const outcome = await withTimeout(20, undefined, (signal) => {
      return new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => resolve('aborted'), { once: true });
        setTimeout(() => resolve('finished'), 1000);
      });
    });
    assert.strictEqual(outcome, 'aborted');
  });

  it('does not interfere when the run finishes first', async () => {
    const outcome = await withTimeout(1000, undefined, async () => 'finished');
    assert.strictEqual(outcome, 'finished');
  });

  it('honours an outer abort signal', async () => {
    const outer = new AbortController();
    const outcome = await withTimeout(undefined, outer.signal, (signal) => {
      return new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => resolve('aborted'), { once: true });
        setTimeout(() => outer.abort(), 10);
      });
    });
    assert.strictEqual(outcome, 'aborted');
  });
});
