import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { createStagingPath } from '../operations/shared/staging.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

const STAGING_PATTERN = /^\..+\.\d+\.[0-9a-f-]{36}\.tmp$/u;

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { readonly code?: unknown }).code === code;
}

describe('staging path security (V-1, V-2, V-4)', () => {
  it('never derives the staging name from a predictable .tmp suffix', () => {
    const first = createStagingPath('/workspace/notes.md');
    const second = createStagingPath('/workspace/notes.md');

    assert.notEqual(first, '/workspace/notes.md.tmp');
    assert.match(first.slice(first.lastIndexOf('/') + 1), STAGING_PATTERN);
    assert.notEqual(first, second);
  });

  it('does not follow a pre-planted <target>.tmp symlink and never touches outside', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symlink creation requires elevated privileges on win32');
      return;
    }

    const root = await mkdtemp(join(tmpdir(), 'brud-staging-symlink-'));
    const workspace = join(root, 'workspace');
    const outside = join(root, 'outside.txt');

    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(outside, 'OUTSIDE-SECRET');
      await symlink(outside, join(workspace, 'notes.md.tmp'));

      const service = new BrudFileSystem(workspace, new DurableNodeStorageDriver());
      await service.initialize();

      await service.writeAtomic('notes.md', 'new content');

      assert.equal(await readFile(outside, 'utf8'), 'OUTSIDE-SECRET');
      assert.equal(await readFile(join(workspace, 'notes.md'), 'utf8'), 'new content');

      const planted = await lstat(join(workspace, 'notes.md.tmp'));
      assert.equal(planted.isSymbolicLink(), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the staging path itself already exists (O_EXCL)', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symlink creation requires elevated privileges on win32');
      return;
    }

    const root = await mkdtemp(join(tmpdir(), 'brud-staging-excl-'));
    const workspace = join(root, 'workspace');
    const outside = join(root, 'outside.txt');

    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(outside, 'OUTSIDE-SECRET');
      await symlink(outside, join(workspace, 'staged.tmp'));

      const driver = new DurableNodeStorageDriver();

      await assert.rejects(
        driver.writeFileExclusive(join(workspace, 'staged.tmp'), 'payload'),
        (error: unknown) => isErrno(error, 'EEXIST'),
      );
      assert.equal(await readFile(outside, 'utf8'), 'OUTSIDE-SECRET');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a legitimate user file named notes.md.tmp intact (V-4)', async () => {
    const driver = new InMemoryStorageDriver();
    const service = new BrudFileSystem('/workspace', driver);
    await service.initialize();

    await service.createFile('notes.md.tmp', 'legitimate user file');

    await service.writeAtomic('notes.md', 'real notes');

    assert.equal(await service.readText('notes.md.tmp'), 'legitimate user file');
    assert.equal(await service.readText('notes.md'), 'real notes');
  });
});

describe('cross-instance staging isolation (V-5)', () => {
  it('uses a unique staging file per writer so concurrent instances never tear', async () => {
    const driver = new InMemoryStorageDriver();
    const first = new BrudFileSystem('/workspace', driver);
    const second = new BrudFileSystem('/workspace', driver);

    await first.initialize();
    await second.initialize();

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        (index % 2 === 0 ? first : second).writeAtomic('contended.txt', `writer-${index}`)),
    );

    assert.match(await first.readText('contended.txt'), /^writer-\d+$/u);
    assert.deepEqual(await first.readDirectory(''), [
      { name: 'contended.txt', isFile: true, isDirectory: false },
    ]);
  });

  it('lets exactly one cross-instance createFile(overwrite:false) win', async () => {
    const driver = new InMemoryStorageDriver();
    const first = new BrudFileSystem('/workspace', driver);
    const second = new BrudFileSystem('/workspace', driver);

    await first.initialize();
    await second.initialize();

    const results = await Promise.allSettled([
      first.createFile('exclusive.txt', 'first', { overwrite: false }),
      second.createFile('exclusive.txt', 'second', { overwrite: false }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { readonly code?: unknown };

    assert.equal(reason.code, 'FILE_ALREADY_EXISTS');
  });
});
