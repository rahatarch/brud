import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceRegistry } from '../workspaceRegistry.js';

const NAMESPACED_KEYS = [
  'exposedApi.scopeRecord.path',
  'filesystem.root',
  'history.root',
  'identity.registry.path',
  'pluginManager.configPath',
  'pluginManager.plugins',
  'pluginManager.root',
  'router.root',
  'settings.root',
  'terminal.root',
  'workspace.root',
].sort();

let root = '';

async function makeWorkspace(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });

  return await realpath(directory);
}

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
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

      setTimeout(poll, 20);
    };

    poll();
  });
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

after(async () => {
  if (root !== '') {
    await rm(root, { recursive: true, force: true });
  }
});

describe('WorkspaceRegistry', () => {
  it('spawns, boots, and lists a workspace', async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-registry-'));
    const workspaceRoot = await makeWorkspace(join(root, 'ws-a'));
    const registry = new WorkspaceRegistry();

    try {
      const workspace = await registry.spawn(workspaceRoot, []);

      assert.equal(workspace.root, workspaceRoot);
      assert.equal(workspace.kernel.lifecycleState, 'RUNNING');
      assert.deepEqual(
        [...Object.keys(workspace.options)].sort(),
        NAMESPACED_KEYS,
      );
      assert.equal('workspaceRoot' in workspace.options, false);
      assert.deepEqual(registry.list().map((entry) => entry.root), [workspaceRoot]);
      assert.equal(registry.get(workspaceRoot), workspace);
    } finally {
      await registry.disposeAll();
    }
  });

  it('attaches and detaches clients and updates lastUsedAt', async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-registry-attach-'));
    const workspaceRoot = await makeWorkspace(join(root, 'ws-a'));
    const registry = new WorkspaceRegistry();

    try {
      const workspace = await registry.spawn(workspaceRoot, []);
      const spawnedAt = workspace.lastUsedAt.getTime();

      await delay(10);
      registry.attachClient(workspaceRoot, 'client-1');

      assert.equal(workspace.clients.has('client-1'), true);
      assert.ok(
        workspace.lastUsedAt.getTime() > spawnedAt,
        'attach must advance lastUsedAt',
      );
      const attachedAt = workspace.lastUsedAt.getTime();

      await delay(10);
      registry.detachClient('client-1');

      assert.equal(workspace.clients.has('client-1'), false);
      assert.ok(
        workspace.lastUsedAt.getTime() > attachedAt,
        'detach must advance lastUsedAt',
      );
    } finally {
      await registry.disposeAll();
    }
  });

  it('rejects attaching to an unknown workspace', () => {
    const registry = new WorkspaceRegistry();

    try {
      assert.throws(() => registry.attachClient('/missing', 'client-1'), /not registered/u);
    } finally {
      void registry.disposeAll();
    }
  });

  it('disposes a workspace by shutting its kernel down', async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-registry-dispose-'));
    const workspaceRoot = await makeWorkspace(join(root, 'ws-a'));
    const registry = new WorkspaceRegistry();

    await registry.spawn(workspaceRoot, []);
    const kernel = registry.get(workspaceRoot)?.kernel;
    assert.ok(kernel !== undefined);

    await registry.dispose(workspaceRoot);

    assert.equal(registry.get(workspaceRoot), undefined);
    assert.deepEqual(registry.list(), []);
    assert.equal(kernel.lifecycleState, 'DISPOSED');

    await registry.disposeAll();
  });

  it('disposes client-less workspaces after the idle window', async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-registry-idle-'));
    const workspaceRoot = await makeWorkspace(join(root, 'ws-a'));
    const registry = new WorkspaceRegistry({
      idleTimeoutMs: 60,
      idleCheckIntervalMs: 10,
    });

    try {
      await registry.spawn(workspaceRoot, []);
      const kernel = registry.get(workspaceRoot)?.kernel;
      assert.ok(kernel !== undefined);

      await waitFor(() => registry.get(workspaceRoot) === undefined);

      assert.equal(registry.get(workspaceRoot), undefined);
      assert.equal(kernel.lifecycleState, 'DISPOSED');
    } finally {
      await registry.disposeAll();
    }
  });

  it('keeps attached workspaces alive across idle sweeps', async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-registry-keepalive-'));
    const workspaceRoot = await makeWorkspace(join(root, 'ws-a'));
    const registry = new WorkspaceRegistry({
      idleTimeoutMs: 40,
      idleCheckIntervalMs: 10,
    });

    try {
      await registry.spawn(workspaceRoot, []);
      registry.attachClient(workspaceRoot, 'client-1');

      await delay(150);

      assert.notEqual(registry.get(workspaceRoot), undefined);
    } finally {
      await registry.disposeAll();
    }
  });

  it('isolates kernels per workspace and per registry', async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-registry-isolation-'));
    const rootA = await makeWorkspace(join(root, 'ws-a'));
    const rootB = await makeWorkspace(join(root, 'ws-b'));
    const rootC = await makeWorkspace(join(root, 'ws-c'));
    const first = new WorkspaceRegistry();
    const second = new WorkspaceRegistry();

    try {
      const workspaceA = await first.spawn(rootA, []);
      const workspaceB = await first.spawn(rootB, []);
      const otherRegistryA = await second.spawn(rootC, []);

      assert.notEqual(workspaceA.kernel, workspaceB.kernel);
      assert.notEqual(workspaceA.kernel, otherRegistryA.kernel);
      assert.deepEqual(
        first.list().map((entry) => entry.root),
        [rootA, rootB],
      );
      assert.deepEqual(second.list().map((entry) => entry.root), [rootC]);
    } finally {
      await first.disposeAll();
      await second.disposeAll();
    }
  });
});