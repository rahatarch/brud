import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  IdleMonitor,
  MINIMUM_IDLE_TIMEOUT_MS,
} from '../lifecycle/idle.js';
import { createDaemon } from '../server/createDaemon.js';
import type { RunningDaemon } from '../server/createDaemon.js';

let root = '';
let workspaceRoot = '';
let daemon: RunningDaemon | undefined;
let previousRuntimeDir: string | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-idle-'));
  previousRuntimeDir = process.env.BRUD_DAEMON_RUNTIME_DIR;
  process.env.BRUD_DAEMON_RUNTIME_DIR = join(root, 'runtime');
  workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  workspaceRoot = await realpath(workspaceRoot);

  daemon = await createDaemon({ workspaceRoot });
});

after(async () => {
  if (daemon !== undefined) {
    await daemon.shutdown();
  }

  if (previousRuntimeDir === undefined) {
    delete process.env.BRUD_DAEMON_RUNTIME_DIR;
  } else {
    process.env.BRUD_DAEMON_RUNTIME_DIR = previousRuntimeDir;
  }

  await rm(root, { recursive: true, force: true });
});

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise<void>((resolve, reject) => {
    const poll = (): void => {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() >= deadline) {
        reject(new Error('condition was not met before the deadline'));
        return;
      }

      setTimeout(poll, 5);
    };

    poll();
  });
}

describe('IdleMonitor', () => {
  it('defaults to the five minute idle window', () => {
    assert.ok(daemon !== undefined);
    assert.equal(daemon.idleMonitor.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
  });

  it('clamps the configured timeout to the minimum window', () => {
    const monitor = new IdleMonitor({
      idleTimeoutMs: 25,
      onIdleShutdown: () => undefined,
    });

    try {
      assert.equal(monitor.idleTimeoutMs, MINIMUM_IDLE_TIMEOUT_MS);
    } finally {
      monitor.dispose();
    }
  });

  it('rejects non-positive and non-finite timeouts', () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => new IdleMonitor({
          idleTimeoutMs: invalid,
          onIdleShutdown: () => undefined,
        }),
        RangeError,
      );
    }
  });

  it('arms only when both connections and in-flight requests are zero', () => {
    assert.ok(daemon !== undefined);
    const monitor = daemon.idleMonitor;

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, true);

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, true, 'arming twice must keep a single armed monitor');

    monitor.update(1, 0);
    assert.equal(monitor.isArmed, false);

    monitor.update(0, 2);
    assert.equal(monitor.isArmed, false);

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, true);

    monitor.update(1, 0);
  });

  it('invokes the idle shutdown callback once per armed window', async () => {
    let idleCount = 0;
    const monitor = new IdleMonitor({
      idleTimeoutMs: 30,
      minimumIdleTimeoutMs: 20,
      onIdleShutdown: () => {
        idleCount += 1;
      },
    });

    try {
      monitor.update(0, 0);
      monitor.update(0, 0);
      await waitFor(() => idleCount === 1);

      assert.equal(idleCount, 1, 'arming twice must not duplicate timers');
      assert.equal(monitor.isArmed, false);

      monitor.update(0, 0);
      await waitFor(() => idleCount === 2);

      assert.equal(idleCount, 2);
    } finally {
      monitor.dispose();
    }
  });

  it('does not fire after disposal', async () => {
    let idleCount = 0;
    const monitor = new IdleMonitor({
      idleTimeoutMs: 30,
      minimumIdleTimeoutMs: 20,
      onIdleShutdown: () => {
        idleCount += 1;
      },
    });

    monitor.update(0, 0);
    monitor.dispose();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });

    assert.equal(idleCount, 0);
    assert.equal(monitor.isArmed, false);

    monitor.update(0, 0);
    assert.equal(monitor.isArmed, false);
  });
});