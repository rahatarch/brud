import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveEndpoint } from '../lifecycle/endpoint.js';

const MAX_SOCKET_PATH_BYTES = 100;
const HASH_LENGTH = 24;

const posixOnly = process.platform === 'win32'
  ? { skip: 'POSIX socket endpoints are unavailable on win32' }
  : {};

let tempBase = '';
let root = '';
let runtimeDir = '';
let previousRuntimeDir: string | undefined;
let previousTempDir: string | undefined;

async function createWorkspace(name: string): Promise<string> {
  const workspace = join(root, name);
  await mkdir(workspace, { recursive: true });
  return realpath(workspace);
}

function preferredSocketLength(base: string): number {
  return Buffer.byteLength(join(base, 'work', 'runtime', `d-${'0'.repeat(HASH_LENGTH)}.sock`));
}

async function assertUsableSocketPath(socketPath: string): Promise<void> {
  const server = createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });

    assert.equal((await stat(socketPath)).isSocket(), true);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

async function createShortTempBase(): Promise<string> {
  if (process.platform === 'win32') {
    return await realpath(await mkdtemp(join(tmpdir(), 'brud-endpoint-')));
  }

  const candidates = [...new Set([tmpdir(), '/tmp', '/var/tmp'])];
  const rejected: string[] = [];

  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) {
      rejected.push(`${candidate} (not absolute)`);
      continue;
    }

    let base = '';

    try {
      base = await realpath(await mkdtemp(join(candidate, 'brud-endpoint-')));
    } catch {
      rejected.push(`${candidate} (not creatable)`);
      continue;
    }

    if (preferredSocketLength(base) < MAX_SOCKET_PATH_BYTES) {
      return base;
    }

    rejected.push(`${base} (${preferredSocketLength(base)} byte preferred socket path)`);
    await rm(base, { recursive: true, force: true });
  }

  throw new Error(`No usable temp base for the endpoint tests: ${rejected.join('; ')}`);
}

before(async () => {
  tempBase = await createShortTempBase();
  previousTempDir = process.env.TMPDIR;
  process.env.TMPDIR = tempBase;
  root = join(tempBase, 'work');
  await mkdir(root, { recursive: true });
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

  if (previousTempDir === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = previousTempDir;
  }

  await rm(tempBase, { recursive: true, force: true });
});

describe('resolveEndpoint', () => {
  it('derives paths under the configured runtime directory', posixOnly, async () => {
    const workspace = await createWorkspace('paths');
    const endpoint = await resolveEndpoint(workspace);
    const preferredSocketPath = join(runtimeDir, `d-${endpoint.workspaceHash}.sock`);

    assert.equal(endpoint.workspaceRoot, workspace);
    assert.equal(endpoint.isWindows, process.platform === 'win32');
    assert.equal(Buffer.byteLength(preferredSocketPath) < MAX_SOCKET_PATH_BYTES, true);
    assert.equal(endpoint.socketPath, preferredSocketPath);
    assert.equal(dirname(endpoint.socketPath), runtimeDir);
    assert.equal(endpoint.lockPath, join(runtimeDir, `d-${endpoint.workspaceHash}.lock`));
    assert.equal(endpoint.tokenPath, join(runtimeDir, `d-${endpoint.workspaceHash}.token`));
    assert.equal(
      endpoint.aiTokenPath,
      join(runtimeDir, `d-${endpoint.workspaceHash}.ai.token`),
    );
    assert.equal(endpoint.metaPath, join(runtimeDir, `d-${endpoint.workspaceHash}.json`));

    await assertUsableSocketPath(endpoint.socketPath);
  });

  it('falls back to the temp directory when the configured socket path does not fit', posixOnly, async () => {
    const workspace = await createWorkspace('fallback');
    const canonical = await realpath(workspace);
    const workspaceHash = createHash('sha256').update(canonical).digest('hex').slice(0, HASH_LENGTH);
    const minimumRuntimeDirBytes =
      MAX_SOCKET_PATH_BYTES - Buffer.byteLength(`d-${'0'.repeat(HASH_LENGTH)}.sock`);
    const baseRuntime = join(root, 'long-runtime');
    const padding = Math.max(0, minimumRuntimeDirBytes - Buffer.byteLength(baseRuntime));
    const longRuntimeDir = `${baseRuntime}${'x'.repeat(padding)}`;
    const preferredSocketPath = join(longRuntimeDir, `d-${workspaceHash}.sock`);
    const fallbackSocketPath = join(tmpdir(), `b-${workspaceHash}.sock`);

    assert.equal(Buffer.byteLength(preferredSocketPath) >= MAX_SOCKET_PATH_BYTES, true);
    assert.equal(Buffer.byteLength(fallbackSocketPath) < MAX_SOCKET_PATH_BYTES, true);

    process.env.BRUD_DAEMON_RUNTIME_DIR = longRuntimeDir;

    try {
      const endpoint = await resolveEndpoint(workspace);

      assert.equal(endpoint.workspaceHash, workspaceHash);
      assert.equal(endpoint.runtimeDir, longRuntimeDir);
      assert.equal(endpoint.socketPath, fallbackSocketPath);
      assert.notEqual(endpoint.socketPath, preferredSocketPath);
      assert.equal(dirname(endpoint.socketPath), tmpdir());
      assert.notEqual(dirname(endpoint.socketPath), longRuntimeDir);
      assert.equal(Buffer.byteLength(endpoint.socketPath) < MAX_SOCKET_PATH_BYTES, true);
      assert.equal(endpoint.lockPath, join(longRuntimeDir, `d-${workspaceHash}.lock`));
      assert.equal(endpoint.tokenPath, join(longRuntimeDir, `d-${workspaceHash}.token`));
      assert.equal(endpoint.aiTokenPath, join(longRuntimeDir, `d-${workspaceHash}.ai.token`));
      assert.equal(endpoint.metaPath, join(longRuntimeDir, `d-${workspaceHash}.json`));

      const info = await stat(longRuntimeDir);
      assert.equal(info.mode & 0o777, 0o700);

      await assertUsableSocketPath(endpoint.socketPath);
    } finally {
      process.env.BRUD_DAEMON_RUNTIME_DIR = runtimeDir;
    }
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
