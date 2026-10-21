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

function createPortHarness(preferredPort: number) {
  let available = false;
  let ephemeral = 5100;
  const requested: Array<number | undefined> = [];
  const closed: number[] = [];

  const startServer = async (
    root: string,
    options?: { preferredPort?: number },
  ): Promise<McpServerHandle> => {
    requested.push(options?.preferredPort);
    if (options?.preferredPort !== undefined) {
      if (!available) {
        const failure = new Error('in use') as NodeJS.ErrnoException;
        failure.code = 'EADDRINUSE';
        throw failure;
      }
      return handle(preferredPort, root);
    }
    ephemeral += 1;
    return handle(ephemeral, root);
  };

  function handle(port: number, root: string): McpServerHandle {
    return {
      url: `http://127.0.0.1:${port}/mcp`,
      port,
      workspaceRoot: root,
      close: async () => {
        closed.push(port);
      },
    };
  }

  const service = new McpServerService({
    startServer,
    getWorkspaceRoot: () => '/project/one',
    preferredPort,
    claimRetryMs: 10,
    isPortAvailable: async () => available,
  });

  return {
    service,
    requested,
    closed,
    releasePreferred: () => {
      available = true;
    },
  };
}

describe('preferred port', () => {
  it('binds the preferred port when it is free', async () => {
    const h = createPortHarness(8899);
    h.releasePreferred();

    const status = await h.service.start();

    assert.strictEqual(status.port, 8899);
    assert.deepStrictEqual(h.requested, [8899]);
  });

  it('falls back to an ephemeral port when another window holds it', async () => {
    const h = createPortHarness(8899);

    const status = await h.service.start();

    assert.strictEqual(status.phase, 'running');
    assert.notStrictEqual(status.port, 8899);
    await h.service.stop();
  });

  it('claims the preferred port once it becomes free and closes the old one', async () => {
    const h = createPortHarness(8899);
    const first = await h.service.start();
    const ephemeralPort = first.port as number;

    h.releasePreferred();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const status = h.service.getStatus();
    assert.strictEqual(status.port, 8899);
    assert.ok(h.closed.includes(ephemeralPort));
    await h.service.stop();
  });

  it('stops claiming after the service stops', async () => {
    const h = createPortHarness(8899);
    await h.service.start();
    await h.service.stop();

    const before = h.requested.length;
    h.releasePreferred();
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.strictEqual(h.requested.length, before);
  });
});
