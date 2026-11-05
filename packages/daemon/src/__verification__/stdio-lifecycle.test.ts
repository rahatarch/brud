/**
 * Goal 9 — daemon `--stdio` lifecycle.
 *
 * Every assertion observes a real daemon subprocess and its real process
 * lifetime. No in-process daemon is used here.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  INITIALIZE_PARAMS,
  RawMcpClient,
  createWorkspace,
  endpointOf,
  pidAlive,
  waitForPidGone,
} from './support/harness.js';

function assertJsonFrame(client: RawMcpClient): void {
  assert.deepEqual(client.nonJsonLines, [], 'stdout must contain only JSON-RPC frames');
  assert.ok(client.frames.length > 0, 'the daemon must have written response frames');
  for (const frame of client.frames) {
    assert.doesNotThrow(() => JSON.parse(frame), `invalid stdout frame: ${frame.slice(0, 120)}`);
  }
}

async function stop(client: RawMcpClient): Promise<number | null> {
  if (client.process.exitCode === null) {
    client.kill('SIGKILL');
  }

  return await client.waitForExit().catch(() => null);
}

describe('Goal 9 — stdio startup and shutdown', () => {
  it('initializes, lists tools and exits 0 when stdin closes', { timeout: 25_000 }, async () => {
    const workspace = await createWorkspace('brud-stdio-basic-');
    const client = new RawMcpClient(workspace);

    try {
      const initialized = await client.request('initialize', INITIALIZE_PARAMS);

      assert.equal(initialized.error, undefined);
      const listed = await client.request('tools/list', {});

      assert.ok(Array.isArray((listed.result as { tools?: unknown }).tools));
      client.closeStdin();
      assert.equal(await client.waitForExit(), 0, client.stderr);
      assertJsonFrame(client);
    } finally {
      await stop(client);
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('keeps stdout free of banners, warnings and log lines', { timeout: 25_000 }, async () => {
    const workspace = await createWorkspace('brud-stdio-clean-');
    const client = new RawMcpClient(workspace);

    try {
      await client.request('initialize', INITIALIZE_PARAMS);
      await client.request('tools/list', {});
      client.closeStdin();
      await client.waitForExit();

      assertJsonFrame(client);
      assert.doesNotMatch(client.frames.join('\n'), /\[plugin:|ready \(workspace|listening on/u);
      assert.match(client.stderr, /brud-daemon stdio mode ready/u);
    } finally {
      await stop(client);
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('exits cleanly on SIGTERM', { timeout: 25_000 }, async () => {
    const workspace = await createWorkspace('brud-stdio-sigterm-');
    const client = new RawMcpClient(workspace);

    try {
      await client.request('initialize', INITIALIZE_PARAMS);
      client.kill('SIGTERM');

      assert.equal(await client.waitForExit(), 0, client.stderr);
      assert.match(client.stderr, /stopped \(SIGTERM\)/u);
    } finally {
      await stop(client);
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('handles stdin EOF during an in-flight Terminal request without crashing', { timeout: 30_000 }, async () => {
    const workspace = await createWorkspace('brud-stdio-eof-');
    const client = new RawMcpClient(workspace);

    try {
      await client.request('initialize', INITIALIZE_PARAMS);
      const pending = client.request(
        'tools/call',
        { name: 'terminal_command', arguments: { command: 'sleep 5', timeout: 20 } },
        20_000,
      ).catch(() => undefined);

      client.closeStdin();
      const exitCode = await client.waitForExit(15_000);

      await pending;
      assert.equal(exitCode, 0, client.stderr);
      assert.doesNotMatch(client.stderr, /UnhandledPromiseRejection|ERR_UNHANDLED/u);
    } finally {
      await stop(client);
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('does not bind a Unix socket or write runtime metadata in stdio mode', { timeout: 25_000 }, async () => {
    const workspace = await createWorkspace('brud-stdio-artifacts-');
    const endpoint = await endpointOf(workspace);
    const client = new RawMcpClient(workspace);

    try {
      await client.request('initialize', INITIALIZE_PARAMS);

      assert.equal(existsSync(endpoint.socketPath), false, 'stdio mode must not bind the socket');
      assert.equal(existsSync(endpoint.lockPath), false, 'stdio mode must not acquire the lock');
      assert.equal(existsSync(endpoint.tokenPath), false, 'stdio mode must not write a token');
      assert.equal(existsSync(endpoint.metaPath), false, 'stdio mode must not write metadata');
      assert.equal(
        existsSync(join(workspace, '.brud', 'mcp-endpoint.json')),
        false,
        'stdio mode must not advertise an HTTP endpoint',
      );
    } finally {
      client.closeStdin();
      await client.waitForExit().catch(() => undefined);
      await stop(client);
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('runs ten rapid start/exit cycles without leaving processes behind', { timeout: 90_000 }, async () => {
    const workspace = await createWorkspace('brud-stdio-cycles-');
    const pids: number[] = [];

    try {
      for (let iteration = 0; iteration < 10; iteration += 1) {
        const client = new RawMcpClient(workspace);
        const pid = client.pid;

        assert.ok(pid);
        pids.push(pid);
        await client.request('initialize', INITIALIZE_PARAMS);
        client.closeStdin();
        assert.equal(await client.waitForExit(), 0, client.stderr);
      }

      for (const pid of pids) {
        assert.equal(pidAlive(pid), false, `pid ${pid} survived its daemon cycle`);
        assert.equal(await waitForPidGone(pid, 2_000), true);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('runs two stdio daemons in parallel without interference', { timeout: 40_000 }, async () => {
    const workspaceA = await createWorkspace('brud-stdio-parallel-a-');
    const workspaceB = await createWorkspace('brud-stdio-parallel-b-');
    await writeFile(join(workspaceA, 'identity.txt'), 'workspace A\n', 'utf8');
    await writeFile(join(workspaceB, 'identity.txt'), 'workspace B\n', 'utf8');
    const clientA = new RawMcpClient(workspaceA);
    const clientB = new RawMcpClient(workspaceB);

    try {
      await clientA.request('initialize', INITIALIZE_PARAMS);
      await clientB.request('initialize', INITIALIZE_PARAMS);

      const readA = await clientA.request('tools/call', {
        name: 'read_file',
        arguments: { filePath: 'identity.txt' },
      });
      const readB = await clientB.request('tools/call', {
        name: 'read_file',
        arguments: { filePath: 'identity.txt' },
      });
      const createA = await clientA.request('tools/call', {
        name: 'create_file',
        arguments: { path: 'only-a.txt', content: 'A\n' },
      });
      const text = (response: typeof readA): string => {
        const result = response.result as
          | { readonly content?: readonly { readonly text?: string }[] }
          | undefined;

        return result?.content?.[0]?.text ?? '';
      };

      assert.match(text(readA), /Read summary/u);
      assert.match(text(readB), /Read summary/u);
      assert.equal((createA.result as { readonly isError?: boolean }).isError, false);
      assert.equal(existsSync(join(workspaceA, 'only-a.txt')), true);
      assert.equal(existsSync(join(workspaceB, 'only-a.txt')), false);
    } finally {
      clientA.closeStdin();
      clientB.closeStdin();
      await clientA.waitForExit().catch(() => undefined);
      await clientB.waitForExit().catch(() => undefined);
      await stop(clientA);
      await stop(clientB);
      await rm(workspaceA, { recursive: true, force: true });
      await rm(workspaceB, { recursive: true, force: true });
    }
  });
});

describe('Goal 9 — response latency', () => {
  let workspace = '';
  let client: RawMcpClient;

  before(async () => {
    workspace = await createWorkspace('brud-stdio-latency-');
    await writeFile(join(workspace, 'latency.txt'), 'latency\n', 'utf8');
    client = new RawMcpClient(workspace);
    await client.request('initialize', INITIALIZE_PARAMS);
  });

  after(async () => {
    client.closeStdin();
    await client.waitForExit().catch(() => undefined);
    await stop(client);
    await rm(workspace, { recursive: true, force: true });
  });

  it('answers tools/list in under 500 ms', { timeout: 20_000 }, async () => {
    const started = Date.now();
    const response = await client.request('tools/list', {});
    const elapsed = Date.now() - started;

    assert.equal(response.error, undefined);
    assert.ok(elapsed < 500, `tools/list took ${elapsed}ms`);
  });

  it('answers a read_file tools/call in under 500 ms', { timeout: 20_000 }, async () => {
    const started = Date.now();
    const response = await client.request('tools/call', {
      name: 'read_file',
      arguments: { filePath: 'latency.txt' },
    });
    const elapsed = Date.now() - started;

    assert.equal(response.error, undefined);
    assert.ok(elapsed < 500, `read_file took ${elapsed}ms`);
  });
});