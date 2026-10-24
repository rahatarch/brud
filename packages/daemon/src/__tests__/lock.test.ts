import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveEndpoint } from '../lifecycle/endpoint.js';
import type { DaemonEndpoint } from '../lifecycle/endpoint.js';
import {
  acquireDaemonLock,
  isPidAlive,
  LockContentionError,
  releaseDaemonLock,
} from '../lifecycle/lock.js';
import type { DaemonLockRecord } from '../lifecycle/lock.js';

const posixOnly = process.platform === 'win32'
  ? { skip: 'POSIX socket artifacts are unavailable on win32' }
  : {};

let root = '';
let previousRuntimeDir: string | undefined;

async function createEndpoint(name: string): Promise<DaemonEndpoint> {
  const workspace = join(root, name);
  await mkdir(workspace, { recursive: true });
  return resolveEndpoint(workspace);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function spawnDeadPid(): number {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(result.status, 0);

  if (result.pid === undefined) {
    throw new Error('Failed to spawn a helper process');
  }

  return result.pid;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-lock-'));
  previousRuntimeDir = process.env.BRUD_DAEMON_RUNTIME_DIR;
  process.env.BRUD_DAEMON_RUNTIME_DIR = join(root, 'runtime');
});

after(async () => {
  if (previousRuntimeDir === undefined) {
    delete process.env.BRUD_DAEMON_RUNTIME_DIR;
  } else {
    process.env.BRUD_DAEMON_RUNTIME_DIR = previousRuntimeDir;
  }

  await rm(root, { recursive: true, force: true });
});

describe('daemon lock', () => {
  it('acquires a fresh lock with owner-only permissions', async () => {
    const endpoint = await createEndpoint('fresh');
    const handle = await acquireDaemonLock(endpoint, { pid: process.pid, version: '0.0.1-test' });

    assert.equal(handle.lockPath, endpoint.lockPath);
    assert.equal(handle.record.pid, process.pid);
    assert.equal(handle.record.workspaceRoot, endpoint.workspaceRoot);

    const info = await stat(endpoint.lockPath);
    assert.equal(info.mode & 0o777, 0o600);

    const persisted = JSON.parse(await readFile(endpoint.lockPath, 'utf8')) as unknown;
    assert.deepEqual(persisted, handle.record);

    await handle.release();
    assert.equal(await pathExists(endpoint.lockPath), false);
  });

  it('rejects acquisition when the recorded pid is alive', async () => {
    const endpoint = await createEndpoint('contention');
    const handle = await acquireDaemonLock(endpoint, { pid: process.pid, version: '0.0.1-test' });

    try {
      await assert.rejects(
        () => acquireDaemonLock(endpoint, { pid: process.pid, version: '0.0.1-test' }),
        (error: unknown) => {
          assert.ok(error instanceof LockContentionError);
          assert.equal(error.existingPid, process.pid);
          return true;
        },
      );
    } finally {
      await handle.release();
    }
  });

  it('reclaims a lock and socket left behind by a dead pid', posixOnly, async () => {
    const endpoint = await createEndpoint('stale');
    const deadPid = spawnDeadPid();

    assert.equal(isPidAlive(deadPid), false);

    const stale: DaemonLockRecord = {
      pid: deadPid,
      startedAt: Date.now() - 60_000,
      version: '0.0.0-stale',
      workspaceRoot: endpoint.workspaceRoot,
    };

    await writeFile(endpoint.lockPath, JSON.stringify(stale), { encoding: 'utf8', mode: 0o600 });
    await writeFile(endpoint.socketPath, '', { encoding: 'utf8', mode: 0o600 });

    const handle = await acquireDaemonLock(endpoint, { pid: process.pid, version: '0.0.1-test' });

    assert.equal(handle.record.pid, process.pid);
    assert.equal(await pathExists(endpoint.socketPath), false);

    await releaseDaemonLock(endpoint);
    assert.equal(await pathExists(endpoint.lockPath), false);
  });

  it('reports pid liveness for invalid identifiers', () => {
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(Number.NaN), false);
  });
});
