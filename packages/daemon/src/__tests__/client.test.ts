import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as Protocol from '@brud/protocol';
import type {
  DaemonInfoResult,
  DaemonPingResult,
} from '@brud/protocol';
import { DaemonClient } from '../client/DaemonClient.js';
import { connectToDaemon } from '../client/connectToDaemon.js';
import {
  DaemonDisconnectedError,
  DaemonNotRunningError,
  DaemonRequestCancelledError,
  DaemonRequestTimeoutError,
  DaemonRpcError,
  DaemonStartupTimeoutError,
} from '../client/errors.js';
import { spawnDaemon } from '../client/spawn.js';
import { resolveEndpoint } from '../lifecycle/endpoint.js';
import { acquireDaemonLock, isPidAlive } from '../lifecycle/lock.js';
import { createDaemon } from '../server/createDaemon.js';
import type { RunningDaemon } from '../server/createDaemon.js';

const SLOW_COMMAND = 'exec sleep 2';

async function createWorkspace(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

interface SpawnedMetadata {
  readonly pid: number;
  readonly workspaceRoot: string;
}

function parseSpawnedMetadata(value: unknown): SpawnedMetadata | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  if (!('pid' in value) || !('workspaceRoot' in value)) {
    return undefined;
  }

  const { pid, workspaceRoot } = value;

  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  if (typeof workspaceRoot !== 'string') {
    return undefined;
  }

  return { pid, workspaceRoot };
}

async function stopSpawnedDaemon(workspaceRoot: string): Promise<void> {
  let endpoint;

  try {
    endpoint = await resolveEndpoint(workspaceRoot);
  } catch {
    return;
  }

  let metadata: SpawnedMetadata | undefined;

  try {
    metadata = parseSpawnedMetadata(
      JSON.parse(await readFile(endpoint.metaPath, 'utf8')) as unknown,
    );
  } catch {
    return;
  }

  if (metadata === undefined || metadata.workspaceRoot !== endpoint.workspaceRoot) {
    return;
  }

  if (metadata.pid === process.pid) {
    return;
  }

  try {
    process.kill(metadata.pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + 3_000;

  while (isPidAlive(metadata.pid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  if (isPidAlive(metadata.pid)) {
    try {
      process.kill(metadata.pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

let root = '';
let runningWorkspace = '';
let coldWorkspace = '';
let timeoutWorkspace = '';
let idleWorkspace = '';
let dropWorkspace = '';
let previousRuntimeDir: string | undefined;
let runningDaemon: RunningDaemon | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-client-'));
  previousRuntimeDir = process.env.BRUD_DAEMON_RUNTIME_DIR;
  process.env.BRUD_DAEMON_RUNTIME_DIR = join(root, 'runtime');

  runningWorkspace = await createWorkspace(join(root, 'running'));
  coldWorkspace = await createWorkspace(join(root, 'cold'));
  timeoutWorkspace = await createWorkspace(join(root, 'timeout'));
  idleWorkspace = await createWorkspace(join(root, 'idle'));
  dropWorkspace = await createWorkspace(join(root, 'drop'));

  runningDaemon = await createDaemon({ workspaceRoot: runningWorkspace });
});

after(async () => {
  await stopSpawnedDaemon(coldWorkspace);
  await stopSpawnedDaemon(timeoutWorkspace);
  await stopSpawnedDaemon(dropWorkspace);

  if (runningDaemon !== undefined) {
    await runningDaemon.shutdown();
  }

  if (previousRuntimeDir === undefined) {
    delete process.env.BRUD_DAEMON_RUNTIME_DIR;
  } else {
    process.env.BRUD_DAEMON_RUNTIME_DIR = previousRuntimeDir;
  }

  await rm(root, { recursive: true, force: true });
});

describe('daemon client', () => {
  it('connects to an already-running daemon and completes the handshake', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace, tier: 'ui' });

    t.after(async () => {
      await client.close();
    });

    assert.equal(client.isConnected, true);

    const handshake = client.handshake;
    assert.ok(handshake !== undefined);
    assert.equal(handshake.workspaceRoot, await realpath(runningWorkspace));
    assert.equal(handshake.server.pid, process.pid);
    assert.equal(handshake.protocolVersion, Protocol.DAEMON_PROTOCOL_VERSION);
    assert.equal(handshake.tier, 'ui');
    assert.equal('fs' in handshake.capabilities, false);
    assert.equal('history' in handshake.capabilities, false);

    const ping = await client.request<DaemonPingResult>(Protocol.DAEMON_PING, {
      nonce: 'client-ping',
    });
    assert.equal(ping.nonce, 'client-ping');

    const info = await client.request<DaemonInfoResult>(Protocol.DAEMON_INFO, {});
    assert.equal(info.workspaceRoot, handshake.workspaceRoot);
    assert.equal(info.pid, process.pid);
  });

  it('reuses a responsive daemon when spawnIfMissing is disabled', async (t) => {
    const client = await connectToDaemon({
      workspaceRoot: runningWorkspace,
      tier: 'ui',
      spawnIfMissing: false,
    });

    t.after(async () => {
      await client.close();
    });

    assert.ok(client.handshake !== undefined);
    assert.equal(client.handshake.server.pid, process.pid);
  });

  it('translates wire errors into typed DaemonRpcError instances', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace, tier: 'ui' });

    t.after(async () => {
      await client.close();
    });

    const removedMethod = 'fs.readFile';

    await assert.rejects(
      () => client.request(removedMethod, { path: '../escape.txt' }),
      (error: unknown) => {
        assert.ok(error instanceof DaemonRpcError);
        assert.equal(error.code, Protocol.METHOD_NOT_FOUND);
        assert.deepEqual(error.details, { method: removedMethod });
        assert.equal(error.method, removedMethod);
        return true;
      },
    );
  });

  it('rejects requests that exceed their timeout while the real daemon keeps running', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace, tier: 'ui' });

    t.after(async () => {
      await client.close();
    });

    await assert.rejects(
      () => client.request(
        Protocol.TOOLS_EXECUTE,
        { name: 'terminal_command', input: { command: SLOW_COMMAND } },
        { timeoutMs: 60 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof DaemonRequestTimeoutError);
        assert.equal(error.method, Protocol.TOOLS_EXECUTE);
        assert.equal(error.timeoutMs, 60);
        return true;
      },
    );

    assert.equal(client.isConnected, true);
  });

  it('cancels in-flight requests through an AbortSignal', async (t) => {
    const client = await connectToDaemon({ workspaceRoot: runningWorkspace, tier: 'ui' });

    t.after(async () => {
      await client.close();
    });

    const controller = new AbortController();
    const pending = client.request(
      Protocol.TOOLS_EXECUTE,
      { name: 'terminal_command', input: { command: SLOW_COMMAND } },
      { timeoutMs: 5_000, signal: controller.signal },
    );

    controller.abort();

    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof DaemonRequestCancelledError);
      assert.equal(error.method, Protocol.TOOLS_EXECUTE);
      return true;
    });

    assert.equal(client.isConnected, true);
  });

  it('drops the connection and refuses retries when the daemon dies mid-request', async (t) => {
    const client = await connectToDaemon({
      workspaceRoot: dropWorkspace,
      tier: 'ui',
      timeoutMs: 10_000,
    });

    t.after(async () => {
      await client.close();
      await stopSpawnedDaemon(dropWorkspace);
    });

    const pid = client.handshake?.server.pid;
    assert.ok(pid !== undefined);
    assert.notEqual(pid, process.pid);

    const pending = client.request(Protocol.TOOLS_EXECUTE, {
      name: 'terminal_command',
      input: { command: 'exec sleep 5' },
    });

    await delay(200);
    process.kill(pid, 'SIGKILL');

    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof DaemonDisconnectedError);
      return true;
    });

    assert.equal(client.isConnected, false);

    await assert.rejects(
      () => client.request(Protocol.TOOLS_EXECUTE, {
        name: 'terminal_command',
        input: { command: 'echo never-retried' },
      }),
      DaemonDisconnectedError,
    );
  });

  it('refuses a cold workspace when spawnIfMissing is disabled', async () => {
    const canonicalRoot = await realpath(idleWorkspace);

    await assert.rejects(
      () => connectToDaemon({ workspaceRoot: idleWorkspace, tier: 'ui', spawnIfMissing: false }),
      (error: unknown) => {
        assert.ok(error instanceof DaemonNotRunningError);
        assert.equal(error.workspaceRoot, canonicalRoot);
        return true;
      },
    );
  });

  it('spawns a detached daemon on demand and connects to it', async (t) => {
    let client: DaemonClient | undefined;
    let secondClient: DaemonClient | undefined;

    t.after(async () => {
      await secondClient?.close();
      await client?.close();
      await stopSpawnedDaemon(coldWorkspace);
    });

    client = await connectToDaemon({ workspaceRoot: coldWorkspace, tier: 'ui', timeoutMs: 10_000 });

    assert.ok(client.handshake !== undefined);
    assert.notEqual(client.handshake.server.pid, process.pid);
    assert.equal(client.handshake.workspaceRoot, await realpath(coldWorkspace));

    const write = await client.request<Protocol.ToolsExecuteResult>(
      Protocol.TOOLS_EXECUTE,
      {
        name: 'create_file',
        input: { path: 'cold/created.txt', content: 'spawned daemon' },
      },
    );
    assert.equal(write.result.status, 'success', String(write.result.error));
    assert.equal(
      await readFile(join(coldWorkspace, 'cold', 'created.txt'), 'utf8'),
      'spawned daemon',
    );

    secondClient = await connectToDaemon({
      workspaceRoot: coldWorkspace,
      tier: 'ui',
      spawnIfMissing: false,
    });

    assert.ok(secondClient.handshake !== undefined);
    assert.equal(secondClient.handshake.server.pid, client.handshake.server.pid);
  });

  it('throws DaemonStartupTimeoutError when a controlled daemon cannot start', async () => {
    const endpoint = await resolveEndpoint(timeoutWorkspace);
    const lock = await acquireDaemonLock(endpoint, {
      pid: process.pid,
      version: '0.0.1-test',
    });

    try {
      await assert.rejects(
        () => spawnDaemon(timeoutWorkspace, { timeoutMs: 400 }),
        (error: unknown) => {
          assert.ok(error instanceof DaemonStartupTimeoutError);
          assert.equal(error.timeoutMs, 400);
          return true;
        },
      );
    } finally {
      await lock.release();
    }
  });
});