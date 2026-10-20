import { describe, it } from 'node:test';
import assert from 'node:assert';
import { McpServerService } from '../McpServerService';
import type { McpServerHandle, McpServerStatus } from '../McpServerService';

function createHarness(options?: { failWith?: string }) {
  let workspaceRoot: string | undefined = '/project/one';
  const started: string[] = [];
  const closed: string[] = [];
  let refreshed = 0;
  let counter = 0;

  const startServer = async (root: string): Promise<McpServerHandle> => {
    started.push(root);
    if (options?.failWith) {
      throw new Error(options.failWith);
    }
    counter += 1;
    const port = 4000 + counter;
    return {
      url: `http://127.0.0.1:${port}/mcp`,
      port,
      workspaceRoot: root,
      refreshSettings: () => {
        refreshed += 1;
      },
      close: async () => {
        closed.push(root);
      },
    };
  };

  const service = new McpServerService({
    startServer,
    getWorkspaceRoot: () => workspaceRoot,
  });

  return {
    service,
    started,
    closed,
    refreshedCalls: () => refreshed,
    setWorkspaceRoot: (root: string | undefined) => {
      workspaceRoot = root;
    },
  };
}

describe('McpServerService', () => {
  it('starts a server anchored to the workspace', async () => {
    const h = createHarness();
    const status = await h.service.start();
    assert.strictEqual(status.phase, 'running');
    assert.strictEqual(status.workspaceRoot, '/project/one');
    assert.strictEqual(status.port, 4001);
    assert.strictEqual(h.started.length, 1);
  });

  it('does not start twice', async () => {
    const h = createHarness();
    await h.service.start();
    await h.service.start();
    assert.strictEqual(h.started.length, 1);
  });

  it('serializes two concurrent starts into one server', async () => {
    const h = createHarness();
    await Promise.all([h.service.start(), h.service.start()]);
    assert.strictEqual(h.started.length, 1);
  });

  it('stops a running server and releases the handle', async () => {
    const h = createHarness();
    await h.service.start();
    const status = await h.service.stop();
    assert.strictEqual(status.phase, 'stopped');
    assert.deepStrictEqual(h.closed, ['/project/one']);
  });

  it('is harmless to stop when already stopped', async () => {
    const h = createHarness();
    const status = await h.service.stop();
    assert.strictEqual(status.phase, 'stopped');
    assert.strictEqual(h.started.length, 0);
  });

  it('reports a missing workspace without starting', async () => {
    const h = createHarness();
    h.setWorkspaceRoot(undefined);
    const status = await h.service.start();
    assert.strictEqual(status.phase, 'stopped');
    assert.match(status.error ?? '', /no project folder/i);
    assert.strictEqual(h.started.length, 0);
  });

  it('surfaces a failed start as a stopped state with the reason', async () => {
    const h = createHarness({ failWith: 'Port 4000 is already in use.' });
    const status = await h.service.start();
    assert.strictEqual(status.phase, 'stopped');
    assert.strictEqual(status.error, 'Port 4000 is already in use.');
  });

  it('restarts onto a new workspace when re-anchored', async () => {
    const h = createHarness();
    await h.service.start();
    h.setWorkspaceRoot('/project/two');
    const status = await h.service.reanchor();
    assert.strictEqual(status.workspaceRoot, '/project/two');
    assert.deepStrictEqual(h.started, ['/project/one', '/project/two']);
    assert.deepStrictEqual(h.closed, ['/project/one']);
  });

  it('does nothing on re-anchor when the workspace is unchanged', async () => {
    const h = createHarness();
    await h.service.start();
    await h.service.reanchor();
    assert.strictEqual(h.started.length, 1);
  });

  it('stays stopped on re-anchor when no server is running', async () => {
    const h = createHarness();
    h.setWorkspaceRoot('/project/two');
    const status = await h.service.reanchor();
    assert.strictEqual(status.phase, 'stopped');
    assert.strictEqual(h.started.length, 0);
  });

  it('emits transitions to listeners and stops after dispose', async () => {
    const h = createHarness();
    const phases: McpServerStatus['phase'][] = [];
    const subscription = h.service.onDidChange((status) => phases.push(status.phase));
    await h.service.start();
    assert.deepStrictEqual(phases, ['starting', 'running']);
    subscription.dispose();
    await h.service.stop();
    assert.deepStrictEqual(phases, ['starting', 'running']);
  });

  it('starts on sync when auto-start is enabled and nothing is running', async () => {
    const h = createHarness();
    const status = await h.service.sync(true);
    assert.strictEqual(status.phase, 'running');
    assert.strictEqual(h.started.length, 1);
  });

  it('stays stopped on sync when auto-start is disabled', async () => {
    const h = createHarness();
    const status = await h.service.sync(false);
    assert.strictEqual(status.phase, 'stopped');
    assert.strictEqual(h.started.length, 0);
  });

  it('does not restart on sync when the project is unchanged', async () => {
    const h = createHarness();
    await h.service.start();
    await h.service.sync(true);
    assert.strictEqual(h.started.length, 1);
  });

  it('re-anchors on sync when a different project is open', async () => {
    const h = createHarness();
    await h.service.start();
    h.setWorkspaceRoot('/project/two');
    const status = await h.service.sync(true);
    assert.strictEqual(status.workspaceRoot, '/project/two');
    assert.deepStrictEqual(h.started, ['/project/one', '/project/two']);
  });

  it('stops on sync when the project is closed', async () => {
    const h = createHarness();
    await h.service.start();
    h.setWorkspaceRoot(undefined);
    const status = await h.service.sync(false);
    assert.strictEqual(status.phase, 'stopped');
    assert.deepStrictEqual(h.closed, ['/project/one']);
  });

  it('forwards settings refresh only while a server is running', async () => {
    const h = createHarness();
    h.service.refreshSettings();
    assert.strictEqual(h.refreshedCalls(), 0);
    await h.service.start();
    h.service.refreshSettings();
    assert.strictEqual(h.refreshedCalls(), 1);
    await h.service.stop();
    h.service.refreshSettings();
    assert.strictEqual(h.refreshedCalls(), 1);
  });

  it('stops the server on dispose', async () => {
    const h = createHarness();
    await h.service.start();
    const status = await h.service.dispose();
    assert.strictEqual(status.phase, 'stopped');
    assert.deepStrictEqual(h.closed, ['/project/one']);
  });
});
