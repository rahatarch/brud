import { strict as assert } from 'node:assert';
import { access, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { IStorageDriver } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { LockContentionError } from '../lifecycle/lock.js';
import { createDaemon } from '../server/createDaemon.js';

let root = '';
let workspace = '';
let previousRuntimeDir: string | undefined;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-lifecycle-'));
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });

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

describe('daemon lifecycle', () => {
  it('boots, enforces single-instance locking, and tears down cleanly', async (t) => {
    const kernelModule = await import('@brud/kernel');
    const storageDriver: IStorageDriver = new kernelModule.InMemoryStorageDriver();
    const daemon = await createDaemon({ workspaceRoot: workspace, storageDriver });

    t.after(async () => {
      await daemon.shutdown();
    });

    assert.equal(daemon.kernel.lifecycleState, 'RUNNING');
    assert.equal(await pathExists(daemon.endpoint.lockPath), true);
    assert.equal(await pathExists(daemon.endpoint.tokenPath), true);
    assert.equal(await pathExists(daemon.endpoint.metaPath), true);
    assert.equal(daemon.isShuttingDown(), false);

    if (process.platform !== 'win32') {
      const socketInfo = await stat(daemon.endpoint.socketPath);
      assert.equal(socketInfo.isSocket(), true);
    }

    const tokenContent = await readFile(daemon.endpoint.tokenPath, 'utf8');
    assert.equal(tokenContent, daemon.token);
    assert.match(tokenContent, /^[0-9a-f]{64}$/);

    const tokenInfo = await stat(daemon.endpoint.tokenPath);
    assert.equal(tokenInfo.mode & 0o777, 0o600);

    const metadata = JSON.parse(await readFile(daemon.endpoint.metaPath, 'utf8')) as unknown;
    assert.equal(typeof metadata, 'object');

    if (typeof metadata === 'object' && metadata !== null) {
      assert.equal('pid' in metadata ? metadata.pid : undefined, process.pid);
      assert.equal('workspaceRoot' in metadata ? metadata.workspaceRoot : undefined, daemon.endpoint.workspaceRoot);
      assert.equal('socketPath' in metadata ? metadata.socketPath : undefined, daemon.endpoint.socketPath);
    }

    await assert.rejects(
      () => createDaemon({ workspaceRoot: workspace, storageDriver }),
      LockContentionError,
    );

    assert.equal(await pathExists(daemon.endpoint.tokenPath), true);

    await daemon.shutdown();

    assert.equal(daemon.isShuttingDown(), true);
    assert.equal(daemon.kernel.lifecycleState, 'DISPOSED');
    assert.equal(await pathExists(daemon.endpoint.lockPath), false);
    assert.equal(await pathExists(daemon.endpoint.tokenPath), false);
    assert.equal(await pathExists(daemon.endpoint.metaPath), false);

    if (process.platform !== 'win32') {
      assert.equal(await pathExists(daemon.endpoint.socketPath), false);
    }

    await daemon.shutdown();
  });
});
