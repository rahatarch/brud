/**
 * Goal 2 — Real-environment execution.
 *
 * Every assertion reads the actual file or directory through node:fs on the
 * kernel workspace root. No memory harness and no filesystem mock is used.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DurableNodeStorageDriver } from '../../../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import {
  absolute,
  acquireVerificationLock,
  bootVerificationKernel,
  invoke,
  pluginSourceFiles,
  listReal,
  readAbsolute,
  readAbsoluteBytes,
  readReal,
  realKind,
  realExists,
  releaseVerificationLock,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = dirname(HERE);
const PACKAGE_JSON = join(SOURCE_ROOT, '..', 'package.json');

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-real-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

async function assertRealFile(path: string, content: string): Promise<void> {
  assert.equal(await realKind(kernel.root, path), 'file', `${path} must be a real file`);
  assert.equal(await readReal(kernel.root, path), content);
}

async function assertRealDirectory(path: string): Promise<void> {
  assert.equal(
    await realKind(kernel.root, path),
    'directory',
    `${path} must be a real directory`,
  );
}

describe('Goal 2 — real filesystem mutations', () => {
  it('create_file writes exact bytes to the real disk', async () => {
    const result = await invoke(kernel, 'create_file', {
      path: 'real/create/a.txt',
      content: 'alpha\nbeta',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('real/create/a.txt', 'alpha\nbeta');
  });

  it('append_file mutates the real file with the legacy separator', async () => {
    await writeReal(kernel.root, 'real/append.txt', 'start');

    const result = await invoke(kernel, 'append_file', {
      path: 'real/append.txt',
      content: 'tail',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('real/append.txt', 'start\n\ntail');
  });

  it('search_replace rewrites the real file bytes', async () => {
    await writeReal(kernel.root, 'real/replace.txt', 'before value after');

    const result = await invoke(kernel, 'search_replace', {
      path: 'real/replace.txt',
      search: 'value',
      replace: 'swapped',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('real/replace.txt', 'before swapped after');
  });

  it('delete_file removes the real file from disk', async () => {
    await writeReal(kernel.root, 'real/delete.txt', 'gone');

    const result = await invoke(kernel, 'delete_file', { path: 'real/delete.txt' });

    assert.equal(result.status, 'success');
    assert.equal(await realExists(kernel.root, 'real/delete.txt'), false);
  });

  it('rename_file moves bytes on the real disk', async () => {
    await writeReal(kernel.root, 'real/rename-from.txt', 'rename-me');

    const result = await invoke(kernel, 'rename_file', {
      from: 'real/rename-from.txt',
      to: 'real/rename-to.txt',
    });

    assert.equal(result.status, 'success');
    assert.equal(await realExists(kernel.root, 'real/rename-from.txt'), false);
    await assertRealFile('real/rename-to.txt', 'rename-me');
  });

  it('move_file moves bytes into a real parent directory', async () => {
    await writeReal(kernel.root, 'real/move-from.txt', 'move-me');

    const result = await invoke(kernel, 'move_file', {
      from: 'real/move-from.txt',
      to: 'real/moved/deeper/move-to.txt',
    });

    assert.equal(result.status, 'success');
    assert.equal(await realExists(kernel.root, 'real/move-from.txt'), false);
    await assertRealFile('real/moved/deeper/move-to.txt', 'move-me');
  });

  it('copy_file duplicates bytes onto the real disk', async () => {
    await writeReal(kernel.root, 'real/copy-from.txt', 'copy-me');

    const result = await invoke(kernel, 'copy_file', {
      from: 'real/copy-from.txt',
      to: 'real/copied/copy-to.txt',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('real/copy-from.txt', 'copy-me');
    await assertRealFile('real/copied/copy-to.txt', 'copy-me');
  });

  it('create_directory creates the real directory and empty files', async () => {
    const result = await invoke(kernel, 'create_directory', {
      directoryPath: 'real/newdir',
      files: ['one.txt', 'nested/two.txt'],
    });

    assert.equal(result.status, 'success');
    await assertRealDirectory('real/newdir');
    await assertRealFile('real/newdir/one.txt', '');
    await assertRealFile('real/newdir/nested/two.txt', '');
  });

  it('delete_directory removes the entire real tree', async () => {
    await writeReal(kernel.root, 'real/deletable/a.txt', 'a');
    await writeReal(kernel.root, 'real/deletable/nested/b.txt', 'b');

    const result = await invoke(kernel, 'delete_directory', {
      directoryPath: 'real/deletable',
    });

    assert.equal(result.status, 'success');
    assert.equal(await realExists(kernel.root, 'real/deletable'), false);
  });

  it('move_directory relocates the real tree', async () => {
    await writeReal(kernel.root, 'real/move-dir/a.txt', 'a');
    await writeReal(kernel.root, 'real/move-dir/nested/b.txt', 'b');

    const result = await invoke(kernel, 'move_directory', {
      from: 'real/move-dir',
      to: 'real/moved-dir',
    });

    assert.equal(result.status, 'success');
    assert.equal(await realExists(kernel.root, 'real/move-dir'), false);
    await assertRealFile('real/moved-dir/a.txt', 'a');
    await assertRealFile('real/moved-dir/nested/b.txt', 'b');
  });

  it('append_file_multi appends to every real file returned by Search', async () => {
    await writeReal(kernel.root, 'multi/a.txt', 'A');
    await writeReal(kernel.root, 'multi/b.txt', 'B');
    await writeReal(kernel.root, 'multi/c.txt', 'C');

    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '**/*.txt',
      scope: 'multi',
      content: 'X',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('multi/a.txt', 'A\n\nX');
    await assertRealFile('multi/b.txt', 'B\n\nX');
    await assertRealFile('multi/c.txt', 'C\n\nX');
  });

  it('search_replace_multi replaces in every real file returned by Search', async () => {
    await writeReal(kernel.root, 'multi-replace/a.txt', 'old A');
    await writeReal(kernel.root, 'multi-replace/b.txt', 'old B');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'multi-replace',
      search: 'old',
      replace: 'new',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('multi-replace/a.txt', 'new A');
    await assertRealFile('multi-replace/b.txt', 'new B');
  });

  it('contains no node:fs import anywhere in plugin source', async () => {
    const files = await pluginSourceFiles(SOURCE_ROOT);

    assert.ok(files.length > 0, 'plugin source must be discoverable');

    for (const file of files) {
      const source = await readAbsolute(file);

      assert.doesNotMatch(source, /from\s+['"]node:fs(?:\/promises)?['"]/u, file);
      assert.doesNotMatch(source, /from\s+['"]fs(?:\/promises)?['"]/u, file);
      assert.doesNotMatch(source, /require\(\s*['"]fs['"]\s*\)/u, file);
    }
  });

  it('declares only the kernel and service contract packages as dependencies', async () => {
    const manifest = JSON.parse(await readAbsolute(PACKAGE_JSON)) as {
      dependencies?: Record<string, string>;
    };

    const dependencies = Object.keys(manifest.dependencies ?? {});

    assert.ok(
      dependencies.every(
        (dependency) =>
          dependency === '@brud/kernel' || dependency.startsWith('@brud/service-'),
      ),
      `unexpected dependency in ${JSON.stringify(dependencies)}`,
    );
  });

  it('uses the real DurableNodeStorageDriver', () => {
    assert.ok(kernel.driver instanceof DurableNodeStorageDriver);
  });

  it('creates parent directories on the real disk for create_file', async () => {
    const result = await invoke(kernel, 'create_file', {
      path: 'real/parents/one/two/three.txt',
      content: 'deep',
    });

    assert.equal(result.status, 'success');
    await assertRealFile('real/parents/one/two/three.txt', 'deep');
  });

  it('does not leave staging files behind after a real write', async () => {
    await invoke(kernel, 'create_file', {
      path: 'real/staging-check.txt',
      content: 'durable',
    });

    const entries = await listReal(kernel.root, 'real');
    const staging = entries.filter((name) => name.includes('.tmp'));

    assert.deepEqual(staging, []);
  });

  it('returns bytes that an independent node:fs reader sees after the call', async () => {
    const result = await invoke(kernel, 'create_file', {
      path: 'real/independent.txt',
      content: 'independent-reader',
    });

    assert.equal(result.status, 'success');
    const bytes = await readAbsoluteBytes(absolute(kernel.root, 'real/independent.txt'));

    assert.equal(bytes.toString('utf8'), 'independent-reader');
  });
});