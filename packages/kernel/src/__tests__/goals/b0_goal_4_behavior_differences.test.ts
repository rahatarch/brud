import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KERNEL_ROOT, REPO_ROOT, stripComments } from './_support.js';
import { DurableNodeStorageDriver } from '../../../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { NodeStorageDriver } from '../../../../services/BrudFileSystem/drivers/index.js';
import { writeAtomic } from '../../../../services/BrudFileSystem/operations/write_atomic/writeAtomic.js';
import {
  STAGING_MAX_AGE_MS,
  createStagingPath,
  sweepStaleStagingFiles,
} from '../../../../services/BrudFileSystem/operations/shared/staging.js';
import { WorkspaceService } from '../../../../services/WorkspaceService/orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../../../../services/WorkspaceService/ports/StorageDriverPathPort.js';

const UUID_A = '00000000-0000-4000-8000-000000000000';
const UUID_B = '11111111-1111-4111-8111-111111111111';

async function makeRoot(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), `brud-goal4-${prefix}-`)));
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;

  return typeof code === 'string' ? code : undefined;
}

describe('B0 Goal 4 — the seven recorded behaviour differences are real', () => {
  it('directory order: the driver preserves raw readdir order and never sorts', async () => {
    const root = await makeRoot('order');
    const driver = new DurableNodeStorageDriver();

    try {
      const names = ['zeta.txt', 'alpha.txt', 'mike.txt', 'bravo.txt', 'yankee.txt'];

      for (const name of names) {
        await driver.writeFile(join(root, name), name);
      }

      const driverEntries = await driver.readDir(root);
      const rawEntries = await readdir(root, { withFileTypes: true });

      assert.deepEqual(
        driverEntries.map((entry) => entry.name),
        rawEntries.map((entry) => entry.name),
        'the driver must return the OS order unchanged',
      );

      const driverSource = await readFile(
        join(REPO_ROOT, 'packages/services/BrudFileSystem/drivers/NodeStorageDriver.ts'),
        'utf8',
      );
      const operationSource = await readFile(
        join(REPO_ROOT, 'packages/services/BrudFileSystem/operations/read_directory/readDirectory.ts'),
        'utf8',
      );
      const applicationTest = await readFile(
        join(REPO_ROOT, 'packages/services/BrudFileSystem/operations/read_directory/readDirectory.test.ts'),
        'utf8',
      );

      assert.equal(/\.sort\s*\(/u.test(stripComments(driverSource)), false);
      assert.equal(/\.sort\s*\(/u.test(stripComments(operationSource)), false);
      assert.match(
        stripComments(applicationTest),
        /\.sort\s*\(/u,
        'the application-level test must establish order itself',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('file modes: the real OS mode is reported instead of a fixed 0o644', async () => {
    const root = await makeRoot('modes');
    const driver = new DurableNodeStorageDriver();

    try {
      const file = join(root, 'mode.txt');
      await driver.writeFile(file, 'x');

      const defaultMode = 0o666 & ~process.umask();
      const before = await driver.stat(file);
      assert.equal(before?.mode, defaultMode, 'stat must report the umask-adjusted OS mode');

      await chmod(file, 0o600);
      const after = await driver.stat(file);

      // Windows synthesizes 0o666 for files and ignores chmod mode changes.
      assert.equal(after?.mode, process.platform === 'win32' ? 0o666 : 0o600);
      assert.notEqual(after?.mode, 0o644, 'the deleted in-memory driver reported a fixed 0o644');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flush capability: the durable driver exposes fsync and the base driver genuinely lacks it', async () => {
    const root = await makeRoot('flush');
    const durable = new DurableNodeStorageDriver();
    const base = new NodeStorageDriver();
    const baseSurface = base as unknown as Record<string, unknown>;

    try {
      assert.equal(typeof durable.syncFile, 'function');
      assert.equal(typeof durable.syncDirectory, 'function');
      assert.equal(baseSurface.syncFile, undefined);
      assert.equal(baseSurface.syncDirectory, undefined);

      const file = join(root, 'flush.txt');
      const directory = join(root, 'flush-dir');
      await durable.writeFile(file, 'x');
      await durable.mkdir(directory);

      await durable.syncFile(file);
      await durable.syncDirectory(directory);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('error shape: failures carry real errno codes instead of a synthetic StorageError', async () => {
    const root = await makeRoot('errno');
    const driver = new DurableNodeStorageDriver();

    try {
      await assert.rejects(
        driver.readText(join(root, 'missing.txt')),
        (error: unknown) => {
          assert.equal(errnoCode(error), 'ENOENT');
          assert.notEqual((error as Error).name, 'StorageError');
          return true;
        },
      );

      const existing = join(root, 'existing.txt');
      await driver.writeFile(existing, 'x');
      await assert.rejects(
        driver.writeFileExclusive(existing, 'y'),
        (error: unknown) => errnoCode(error) === 'EEXIST',
      );

      const directory = join(root, 'a-directory');
      await driver.mkdir(directory);
      await assert.rejects(
        driver.readFile(directory),
        (error: unknown) => {
          assert.equal(typeof errnoCode(error), 'string');
          assert.notEqual((error as Error).name, 'StorageError');
          return true;
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('staging/O_EXCL: a pre-planted staging path fails closed and the sweep removes stale files', async () => {
    const root = await makeRoot('staging');
    const driver = new DurableNodeStorageDriver();

    try {
      const target = join(root, 'target.txt');
      const staging = createStagingPath(target, {
        pid: 999_999,
        createId: () => UUID_A,
      });
      await driver.writeFile(staging, 'planted');

      await assert.rejects(
        writeAtomic(driver, target, 'new-content', { stagingPath: staging }),
        (error: unknown) => errnoCode(error) === 'STAGING_CONFLICT'
          || (error as { code?: string }).code === 'STAGING_CONFLICT',
      );
      assert.equal(await driver.exists(target), false, 'the target must not be published');

      await driver.writeFile(staging, 'planted');
      await assert.rejects(
        driver.writeFileExclusive(staging, 'overwrite'),
        (error: unknown) => errnoCode(error) === 'EEXIST',
      );
      assert.equal(await driver.readText(staging), 'planted');
      await driver.deleteFile(staging);

      const staleTarget = join(root, 'sweep-target.txt');
      const stale = createStagingPath(staleTarget, {
        pid: process.pid,
        createId: () => UUID_B,
      });
      const ordinary = join(root, 'ordinary.txt');
      await driver.writeFile(stale, 'stale');
      await driver.writeFile(ordinary, 'ordinary');

      await sweepStaleStagingFiles(driver, root, {
        now: () => Date.now() + STAGING_MAX_AGE_MS * 2,
      });

      assert.equal(await driver.exists(stale), false, 'the stale staging file must be swept');
      assert.equal(await driver.exists(ordinary), true, 'non-staging files must survive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('canonicalization cache: a real mtime change invalidates the memoized path', async () => {
    const root = await makeRoot('cache');
    const driver = new DurableNodeStorageDriver();

    try {
      const service = new WorkspaceService({
        roots: [root],
        port: createStorageDriverPathPort(driver),
      });
      await service.initialize();

      const file = join(root, 'cached.txt');
      await driver.writeFile(file, 'one');

      const batch = service.createBatch();
      await batch.resolve('cached.txt');
      assert.deepEqual(batch.stats, { hits: 0, misses: 1 });

      await batch.resolve('cached.txt');
      assert.deepEqual(batch.stats, { hits: 1, misses: 1 });

      const past = new Date('2001-01-01T00:00:00.000Z');
      await utimes(file, past, past);

      const entry = await driver.lstat(file);
      assert.equal(typeof entry?.mtimeMs, 'number', 'real lstat must supply mtimeMs');

      await batch.resolve('cached.txt');
      assert.equal(batch.stats.misses, 2, 'the changed mtime must force a miss');
      assert.equal(batch.stats.hits, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('symlinks: escape rejected, dangling rejected, inner link followed, root link canonicalized', async () => {
    const base = await makeRoot('symlinks');
    const driver = new DurableNodeStorageDriver();
    const root = join(base, 'root');

    try {
      await mkdir(root);
      const outside = join(base, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, 'secret.txt'), 'secret');
      await symlink(outside, join(root, 'escape'));

      const service = new WorkspaceService({
        roots: [root],
        port: createStorageDriverPathPort(driver),
      });
      await service.initialize();

      await assert.rejects(
        service.resolve('escape/secret.txt'),
        (error: unknown) => (error as { rule?: string }).rule === 'SYMLINK_ESCAPE',
      );

      await symlink(join(base, 'missing-target'), join(root, 'dangling'));
      await assert.rejects(
        service.resolve('dangling/x.txt'),
        (error: unknown) => (error as { rule?: string }).rule === 'SYMLINK_ESCAPE',
      );

      await mkdir(join(root, 'notes'));
      await writeFile(join(root, 'notes/a.md'), 'a');
      await symlink(join(root, 'notes'), join(root, 'inner'));

      const inner = await service.resolve('inner/a.md');
      assert.equal(inner.absolutePath, await realpath(join(root, 'notes/a.md')));
      assert.equal(inner.relativePath, 'notes/a.md');

      const linkedRoot = join(base, 'root-link');
      await symlink(root, linkedRoot);
      const linked = new WorkspaceService({
        roots: [linkedRoot],
        port: createStorageDriverPathPort(driver),
      });
      await linked.initialize();

      assert.equal(linked.primaryRoot, await realpath(root));
      assert.equal((await linked.resolve('notes/a.md')).relativePath, 'notes/a.md');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});