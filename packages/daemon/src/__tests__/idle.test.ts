import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  IdleMonitor,
  MINIMUM_IDLE_TIMEOUT_MS,
} from '../lifecycle/idle.js';
import type { IdleTimerHandle, IdleTimerScheduler } from '../lifecycle/idle.js';

interface ScheduledTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  unrefCount: number;
  cancelled: boolean;
}

class FakeScheduler implements IdleTimerScheduler {
  readonly timers: ScheduledTimer[] = [];

  private readonly handles = new Map<IdleTimerHandle, ScheduledTimer>();

  setTimeout(callback: () => void, delayMs: number): IdleTimerHandle {
    const timer: ScheduledTimer = { callback, delayMs, unrefCount: 0, cancelled: false };
    const handle: IdleTimerHandle = {
      unref: () => {
        timer.unrefCount += 1;
      },
    };

    this.timers.push(timer);
    this.handles.set(handle, timer);

    return handle;
  }

  clearTimeout(handle: IdleTimerHandle): void {
    const timer = this.handles.get(handle);

    if (timer !== undefined) {
      timer.cancelled = true;
    }
  }

  get pending(): readonly ScheduledTimer[] {
    return this.timers.filter((timer) => !timer.cancelled);
  }

  firePending(): void {
    const pending = this.pending;

    for (const timer of pending) {
      timer.cancelled = true;
      timer.callback();
    }
  }
}

function createMonitor(
  scheduler: FakeScheduler,
  idleTimeoutMs?: number,
): { monitor: IdleMonitor; idleCount: () => number } {
  let idleCount = 0;
  const monitor = new IdleMonitor({
    scheduler,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    onIdleShutdown: () => {
      idleCount += 1;
    },
  });

  return { monitor, idleCount: () => idleCount };
}

describe('IdleMonitor', () => {
  it('defaults to the five minute idle window', () => {
    const scheduler = new FakeScheduler();
    const { monitor } = createMonitor(scheduler);

    assert.equal(monitor.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
    monitor.dispose();
  });

  it('clamps the configured timeout to the minimum window', () => {
    const scheduler = new FakeScheduler();
    const { monitor } = createMonitor(scheduler, 25);

    assert.equal(monitor.idleTimeoutMs, MINIMUM_IDLE_TIMEOUT_MS);
    monitor.dispose();
  });

  it('rejects non-positive and non-finite timeouts', () => {
    const scheduler = new FakeScheduler();

    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new IdleMonitor({
          scheduler,
          idleTimeoutMs: invalid,
          onIdleShutdown: () => undefined,
        }),
        RangeError,
      );
    }
  });

  it('arms only when both connections and in-flight requests are zero', () => {
    const scheduler = new FakeScheduler();
    const { monitor } = createMonitor(scheduler, 5_000);

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, true);
    assert.equal(scheduler.pending.length, 1);
    assert.equal(scheduler.pending[0]?.delayMs, 5_000);
    assert.equal(scheduler.pending[0]?.unrefCount, 1);

    monitor.update(0, 0);
    assert.equal(scheduler.timers.length, 1, 'arming twice must not duplicate timers');

    monitor.update(1, 0);
    assert.equal(monitor.isArmed, false);
    assert.equal(scheduler.pending.length, 0);

    monitor.update(0, 2);
    assert.equal(monitor.isArmed, false);

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, true);
    assert.equal(scheduler.pending.length, 1);

    monitor.dispose();
  });

  it('invokes the idle shutdown callback once when the timer fires', () => {
    const scheduler = new FakeScheduler();
    const { monitor, idleCount } = createMonitor(scheduler, 5_000);

    monitor.update(0, 0);
    scheduler.firePending();

    assert.equal(idleCount(), 1);
    assert.equal(monitor.isArmed, false);

    monitor.update(0, 0);
    scheduler.firePending();

    assert.equal(idleCount(), 2);
    monitor.dispose();
  });

  it('does not fire after disposal', () => {
    const scheduler = new FakeScheduler();
    const { monitor, idleCount } = createMonitor(scheduler, 5_000);

    monitor.update(0, 0);
    monitor.dispose();
    scheduler.firePending();

    assert.equal(idleCount(), 0);
    assert.equal(monitor.isArmed, false);

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, false);
  });
});
