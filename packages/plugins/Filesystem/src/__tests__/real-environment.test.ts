import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { certifyOfficialPlugin } from '../../../../services/PluginManager/contracts/branding.js';
import { createSearchPlugin } from '../../../Search/src/index.js';
import { bootTestKernel } from './support/testHarness.js';
import type { TestKernel } from './support/testHarness.js';
import { createFilesystemPlugin } from '../index.js';
import { acquireCrossTestLock, releaseCrossTestLock } from './support/serialLock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = dirname(HERE);

async function pluginSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const child = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }

      files.push(...await pluginSourceFiles(child));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(child);
    }
  }

  return files;
}

before(async () => {
  await acquireCrossTestLock();
});

after(async () => {
  await releaseCrossTestLock();
});

describe('real environment execution', () => {
  it('writes every tool mutation through the real durable filesystem', async () => {
    const filesystem = certifyOfficialPlugin(createFilesystemPlugin());
    const kernel: TestKernel = await bootTestKernel({
      prefix: 'brud-filesystem-real-',
      plugins: [createSearchPlugin(), filesystem],
    });

    try {
      const tool = (name: string, input: Record<string, unknown>) =>
        kernel.tools.executeTool(name, input, {
          workspaceRoot: kernel.root,
          callerId: 'test.real-environment',
        });

      const assertStat = async (path: string, isFile: boolean): Promise<void> => {
        const stats = await kernel.fs.stat(path);

        assert.ok(stats, `${path} must exist`);
        assert.equal(stats.isFile, isFile, `${path} file-ness`);
      };

      const created = await tool('create_file', { path: 'src/a.txt', content: 'A' });
      assert.equal(created.status, 'success');
      await assertStat('src/a.txt', true);

      const appended = await tool('append_file', { path: 'src/a.txt', content: 'B' });
      assert.equal(appended.status, 'success');
      assert.equal(await kernel.fs.readText('src/a.txt'), 'A\n\nB');

      const replaced = await tool('search_replace', {
        path: 'src/a.txt',
        search: 'A',
        replace: 'C',
      });
      assert.equal(replaced.status, 'success');
      assert.equal(await kernel.fs.readText('src/a.txt'), 'C\n\nB');

      const copied = await tool('copy_file', { from: 'src/a.txt', to: 'src/b.txt' });
      assert.equal(copied.status, 'success');
      await assertStat('src/b.txt', true);

      const renamed = await tool('rename_file', { from: 'src/b.txt', to: 'src/c.txt' });
      assert.equal(renamed.status, 'success');
      await assertStat('src/c.txt', true);
      assert.equal(await kernel.fs.exists('src/b.txt'), false);

      const moved = await tool('move_file', {
        from: 'src/c.txt',
        to: 'src/nested/d.txt',
      });
      assert.equal(moved.status, 'success');
      await assertStat('src/nested/d.txt', true);
      assert.equal(await kernel.fs.exists('src/c.txt'), false);

      const directory = await tool('create_directory', {
        directoryPath: 'dir1',
        files: ['f1.txt', 'f2.txt'],
      });
      assert.equal(directory.status, 'success');
      await assertStat('dir1/f1.txt', true);
      await assertStat('dir1/f2.txt', true);

      const movedDirectory = await tool('move_directory', {
        from: 'dir1',
        to: 'dir2',
      });
      assert.equal(movedDirectory.status, 'success');
      await assertStat('dir2/f1.txt', true);
      assert.equal(await kernel.fs.exists('dir1'), false);

      const deletedFile = await tool('delete_file', { path: 'src/nested/d.txt' });
      assert.equal(deletedFile.status, 'success');
      assert.equal(await kernel.fs.exists('src/nested/d.txt'), false);

      const deletedDirectory = await tool('delete_directory', { directoryPath: 'dir2' });
      assert.equal(deletedDirectory.status, 'success');
      assert.equal(await kernel.fs.exists('dir2'), false);

      const appendedMulti = await tool('append_file_multi', {
        pattern: '**/*.txt',
        scope: 'src',
        content: 'X',
      });
      assert.equal(appendedMulti.status, 'success');
      assert.equal(await kernel.fs.readText('src/a.txt'), 'C\n\nB\n\nX');

      const replacedMulti = await tool('search_replace_multi', {
        pattern: '**/*.txt',
        scope: 'src',
        search: 'X',
        replace: 'Y',
      });
      assert.equal(replacedMulti.status, 'success');
      assert.equal(await kernel.fs.readText('src/a.txt'), 'C\n\nB\n\nY');

      // Verify the mutation is on disk, not just in the service cache.
      assert.equal(
        await readFile(join(kernel.root, 'src', 'a.txt'), 'utf8'),
        'C\n\nB\n\nY',
      );

      const sessions = await kernel.history.listSessions({ limit: 100 });
      assert.ok(sessions.length >= 12, `expected at least 12 sessions, got ${sessions.length}`);
    } finally {
      await kernel.shutdown();
    }
  });

  it('contains no direct node:fs usage in plugin source', async () => {
    const files = await pluginSourceFiles(SOURCE_ROOT);

    assert.ok(files.length > 0);

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      assert.doesNotMatch(source, /from\s+['"]node:fs(?:\/promises)?['"]/u, file);
      assert.doesNotMatch(source, /require\(\s*['"]fs['"]\s*\)/u, file);
    }
  });
});