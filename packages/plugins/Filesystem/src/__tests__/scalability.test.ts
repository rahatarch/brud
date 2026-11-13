import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudFileSystem } from '@brud/service-filesystem';
import type { IUniversalHistoryService } from '@brud/service-history';
import { NodeStorageDriver } from '../../../../services/BrudFileSystem/drivers/index.js';
import { SHARED_MUTEX } from '../coordinator/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { searchReplaceMulti } from '../groups/multi/searchReplaceMulti/index.js';
import type { FilesystemRuntime } from '../runtime.js';
import {
  bootTestKernel,
  createRuntime,
} from './support/testHarness.js';
import { errorCode, fakeSearch } from './support/assertions.js';
import { createMemoryRuntime } from './support/memoryHarness.js';
import { acquireCrossTestLock, releaseCrossTestLock } from './support/serialLock.js';

before(async () => {
  await acquireCrossTestLock();
});

after(async () => {
  await releaseCrossTestLock();
});

describe('scalability invariants', () => {
  it('refuses a 1000-file search_replace_multi batch at the governor', async () => {
    const runtime: FilesystemRuntime = {
      getFileSystem: (): IBrudFileSystem => {
        throw new Error('filesystem must not be touched');
      },
      getUniversalHistory: (): IUniversalHistoryService => {
        throw new Error('history must not be touched');
      },
      executeTool: fakeSearch(
        Array.from({ length: 1000 }, (_, index) => `file-${index}.txt`),
      ),
      mutex: SHARED_MUTEX,
      workspaceRoot: '/workspace',
    };

    const result = await searchReplaceMulti(
      { pattern: '**/*.txt', search: 'a', replace: 'b' },
      runtime,
    );

    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
  });

  it('serializes 100 concurrent tool calls correctly', async () => {
    const { fs, runtime } = createMemoryRuntime();

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        createFile(
          { path: `concurrent/file-${index}.txt`, content: `value-${index}` },
          runtime,
        )),
    );

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(fs.files.size, 100);

    for (let index = 0; index < 100; index += 1) {
      assert.equal(
        await fs.readText(`concurrent/file-${index}.txt`),
        `value-${index}`,
      );
    }
  });

  it('keeps memory stable across 1000 single-file operations', async () => {
    const { fs, runtime } = createMemoryRuntime();
    const before = process.memoryUsage().heapUsed;

    for (let index = 0; index < 1000; index += 1) {
      const result = await createFile(
        { path: `memory/file-${index}.txt`, content: `value-${index}` },
        runtime,
      );

      assert.equal(result.status, 'success');
    }

    const delta = process.memoryUsage().heapUsed - before;

    assert.ok(delta < 64 * 1024 * 1024, `heap grew by ${(delta / 1024 / 1024).toFixed(1)}MB`);
    assert.equal(fs.files.size, 1000);
  });

  it('isolates two kernels in one process', async () => {
    const first = await bootTestKernel({
      prefix: 'brud-filesystem-isolate-a-',
      storageDriver: new NodeStorageDriver(),
    });
    const second = await bootTestKernel({
      prefix: 'brud-filesystem-isolate-b-',
      storageDriver: new NodeStorageDriver(),
    });

    try {
      await createFile(
        { path: 'iso.txt', content: 'first' },
        createRuntime(first),
      );
      await createFile(
        { path: 'iso.txt', content: 'second' },
        createRuntime(second),
      );

      assert.notEqual(first.root, second.root);
      assert.equal(await first.fs.readText('iso.txt'), 'first');
      assert.equal(await second.fs.readText('iso.txt'), 'second');
      assert.equal((await first.history.listSessions({ limit: 10 })).length, 1);
      assert.equal((await second.history.listSessions({ limit: 10 })).length, 1);
    } finally {
      await first.shutdown();
      await second.shutdown();
    }
  });
});