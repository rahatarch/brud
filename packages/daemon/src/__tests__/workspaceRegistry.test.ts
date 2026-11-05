import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
import {
  WorkspaceRegistry,
  type WorkspaceRegistryScheduler,
  type WorkspaceRegistryTimerHandle,
} from '../workspaceRegistry.js';

interface ScheduledTimer {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
  unrefCount: number;
}

class FakeScheduler implements WorkspaceRegistryScheduler {
  readonly timers: ScheduledTimer[] = [];

  private readonly handles = new Map<WorkspaceRegistryTimerHandle, ScheduledTimer>();

  setTimeout(callback: () => void, delayMs: number): WorkspaceRegistryTimerHandle {
    const timer: ScheduledTimer = {
      callback,
      delayMs,
      cancelled: false,
      unrefCount: 0,
    };
    const handle: WorkspaceRegistryTimerHandle = {
      unref: () => {
        timer.unrefCount += 1;
      },
    };

    this.timers.push(timer);
    this.handles.set(handle, timer);

    return handle;
  }

  clearTimeout(handle: WorkspaceRegistryTimerHandle): void {
    const timer = this.handles.get(handle);

    if (timer !== undefined) {
      timer.cancelled = true;
    }
  }

  get pending(): readonly ScheduledTimer[] {
    return this.timers.filter((timer) => !timer.cancelled);
  }

  firePending(): void {
    for (const timer of this.pending) {
      timer.cancelled = true;
      timer.callback();
    }
  }
}

class FakeKernel {
  public lifecycleState: 'RUNNING' | 'DISPOSED' = 'RUNNING';

  public bootCount = 0;

  public shutdownCount = 0;

  public bootedAt: string | undefined;

  async boot(options: { readonly workspaceRoot: string }): Promise<void> {
    this.bootCount += 1;
    this.bootedAt = options.workspaceRoot;
    this.lifecycleState = 'RUNNING';
  }

  async shutdown(): Promise<void> {
    this.shutdownCount += 1;
    this.lifecycleState = 'DISPOSED';
  }
}

interface Harness {
  readonly registry: WorkspaceRegistry;
  readonly kernels: Map<string, FakeKernel>;
  readonly scheduler: FakeScheduler;
  readonly now: { value: number };
}

function createHarness(idleTimeoutMs?: number): Harness {
  const kernels = new Map<string, FakeKernel>();
  const scheduler = new FakeScheduler();
  const now = { value: 1_000 };
  const registry = new WorkspaceRegistry({
    scheduler,
    now: () => now.value,
    kernelFactory: async ({ workspaceRoot }) => {
      const kernel = new FakeKernel();
      kernels.set(workspaceRoot, kernel);
      return kernel as unknown as BrudKernel;
    },
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
  });

  return { registry, kernels, scheduler, now };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('WorkspaceRegistry', () => {
  it('spawns, boots, and lists a workspace', async () => {
    const { registry, kernels } = createHarness();

    try {
      const workspace = await registry.spawn('/ws-a', []);

      assert.equal(workspace.root, '/ws-a');
      assert.equal(workspace.kernel.lifecycleState, 'RUNNING');
      assert.equal(kernels.get('/ws-a')?.bootCount, 1);
      assert.equal(kernels.get('/ws-a')?.bootedAt, '/ws-a');
      assert.deepEqual(registry.list().map((entry) => entry.root), ['/ws-a']);
      assert.equal(registry.get('/ws-a'), workspace);
    } finally {
      await registry.disposeAll();
    }
  });

  it('attaches and detaches clients and updates lastUsedAt', async () => {
    const { registry, now } = createHarness();

    try {
      const workspace = await registry.spawn('/ws-a', []);
      const spawnedAt = workspace.lastUsedAt.getTime();

      now.value += 500;
      registry.attachClient('/ws-a', 'client-1');

      assert.equal(workspace.clients.has('client-1'), true);
      assert.equal(workspace.lastUsedAt.getTime(), spawnedAt + 500);

      now.value += 500;
      registry.detachClient('client-1');

      assert.equal(workspace.clients.has('client-1'), false);
      assert.equal(workspace.lastUsedAt.getTime(), spawnedAt + 1_000);
    } finally {
      await registry.disposeAll();
    }
  });

  it('rejects attaching to an unknown workspace', () => {
    const { registry } = createHarness();

    assert.throws(() => registry.attachClient('/missing', 'client-1'), /not registered/u);
  });

  it('disposes a workspace by shutting its kernel down', async () => {
    const { registry, kernels } = createHarness();

    await registry.spawn('/ws-a', []);
    await registry.dispose('/ws-a');

    assert.equal(registry.get('/ws-a'), undefined);
    assert.deepEqual(registry.list(), []);
    assert.equal(kernels.get('/ws-a')?.shutdownCount, 1);
    assert.equal(kernels.get('/ws-a')?.lifecycleState, 'DISPOSED');

    await registry.disposeAll();
  });

  it('disposes client-less workspaces after the idle window', async () => {
    const { registry, kernels, scheduler, now } = createHarness(100);

    try {
      await registry.spawn('/ws-a', []);

      now.value += 500;
      scheduler.firePending();
      await flush();

      assert.equal(registry.get('/ws-a'), undefined);
      assert.equal(kernels.get('/ws-a')?.shutdownCount, 1);
    } finally {
      await registry.disposeAll();
    }
  });

  it('keeps attached workspaces alive across idle sweeps', async () => {
    const { registry, scheduler, now } = createHarness(100);

    try {
      await registry.spawn('/ws-a', []);
      registry.attachClient('/ws-a', 'client-1');

      now.value += 500;
      scheduler.firePending();
      await flush();

      assert.notEqual(registry.get('/ws-a'), undefined);
    } finally {
      await registry.disposeAll();
    }
  });

  it('isolates kernels per workspace and per registry', async () => {
    const first = createHarness();
    const second = createHarness();

    try {
      const workspaceA = await first.registry.spawn('/ws-a', []);
      const workspaceB = await first.registry.spawn('/ws-b', []);
      const otherRegistryA = await second.registry.spawn('/ws-a', []);

      assert.notEqual(workspaceA.kernel, workspaceB.kernel);
      assert.notEqual(workspaceA.kernel, otherRegistryA.kernel);
      assert.deepEqual(
        first.registry.list().map((entry) => entry.root),
        ['/ws-a', '/ws-b'],
      );
      assert.deepEqual(second.registry.list().map((entry) => entry.root), ['/ws-a']);
    } finally {
      await first.registry.disposeAll();
      await second.registry.disposeAll();
    }
  });
});