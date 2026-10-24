import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveEndpoint } from '../lifecycle/endpoint.js';

const posixOnly = process.platform === 'win32'
  ? { skip: 'POSIX socket endpoints are unavailable on win32' }
  : {};

let root = '';
let runtimeDir = '';
let previousRuntimeDir: string | undefined;

async function createWorkspace(name: string): Promise<string> {
  const workspace = join(root, name);
  await mkdir(workspace, { recursive: true });
  return realpath(workspace);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-endpoint-'));
  runtimeDir = join(root, 'runtime');
  previousRuntimeDir = process.env.BRUD_DAEMON_RUNTIME_DIR;
  process.env.BRUD_DAEMON_RUNTIME_DIR = runtimeDir;
});

after(async () => {
  if (previousRuntimeDir === undefined) {
    delete process.env.BRUD_DAEMON_RUNTIME_DIR;
  } else {
    process.env.BRUD_DAEMON_RUNTIME_DIR = previousRuntimeDir;
  }

  await rm(root, { recursive: true, force: true });
});

describe('resolveEndpoint', () => {
  it('derives paths under the configured runtime directory', posixOnly, async () => {
    const workspace = await createWorkspace('paths');
    const endpoint = await resolveEndpoint(workspace);

    assert.equal(endpoint.workspaceRoot, workspace);
    assert.equal(endpoint.isWindows, process.platform === 'win32');
    assert.equal(dirname(endpoint.socketPath), runtimeDir);
    assert.equal(endpoint.lockPath, join(runtimeDir, `d-${endpoint.workspaceHash}.lock`));
    assert.equal(endpoint.tokenPath, join(runtimeDir, `d-${endpoint.workspaceHash}.token`));
    assert.equal(endpoint.metaPath, join(runtimeDir, `d-${endpoint.workspaceHash}.json`));
  });

  it('hashes the canonical workspace root deterministically', posixOnly, async () => {
    const workspace = await createWorkspace('deterministic');
    const canonical = await realpath(workspace);
    const expected = createHash('sha256')
      .update(canonical)
      .digest('hex')
      .slice(0, 24);

    const first = await resolveEndpoint(workspace);
    const second = await resolveEndpoint(`${workspace}/.`);
    const third = await resolveEndpoint(`${workspace}/`);

    assert.equal(first.workspaceHash, expected);
    assert.equal(second.workspaceHash, expected);
    assert.equal(third.workspaceHash, expected);
    assert.equal(first.socketPath, second.socketPath);
    assert.equal(second.lockPath, third.lockPath);
  });

  it('keeps the socket path within the platform length bound', posixOnly, async () => {
    const workspace = await createWorkspace('length');
    const endpoint = await resolveEndpoint(workspace);

    assert.equal(endpoint.socketPath.endsWith('.sock'), true);
    assert.equal(Buffer.byteLength(endpoint.socketPath) < 100, true);
  });

  it('creates the runtime directory with owner-only permissions', posixOnly, async () => {
    const workspace = await createWorkspace('permissions');
    await resolveEndpoint(workspace);

    const info = await stat(runtimeDir);

    assert.equal(info.mode & 0o777, 0o700);
    assert.equal(info.uid, process.getuid?.());
  });

  it('rejects a workspace root that does not exist', async () => {
    await assert.rejects(() => resolveEndpoint(join(root, 'missing-workspace')), /Cannot resolve workspace root/);
  });
});
