import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { IBrudFileSystem, IUniversalHistoryService } from '@brud/kernel';
import { SHARED_MUTEX } from '../coordinator/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { appendFileMulti } from '../groups/multi/appendFileMulti/index.js';
import type { FilesystemRuntime } from '../runtime.js';
import { errorCode, fakeSearch } from './support/assertions.js';
import { createMemoryRuntime } from './support/memoryHarness.js';
import { acquireCrossTestLock, releaseCrossTestLock } from './support/serialLock.js';

before(async () => {
  await acquireCrossTestLock();
});

after(async () => {
  await releaseCrossTestLock();
});

describe('performance budgets', () => {
  it('creates a single file in under 50ms', async () => {
    const { runtime } = createMemoryRuntime();

    await createFile({ path: 'warmup.txt', content: 'warm' }, runtime);

    const started = performance.now();
    const result = await createFile({ path: 'fast.txt', content: 'fast' }, runtime);
    const elapsed = performance.now() - started;

    assert.equal(result.status, 'success');
    assert.ok(elapsed < 50, `create_file took ${elapsed.toFixed(1)}ms`);
  });

  it('appends to 100 files in under 2s', async () => {
    const paths = Array.from({ length: 100 }, (_, index) => `bulk/file-${index}.txt`);
    const { fs, runtime } = createMemoryRuntime({
      executeTool: fakeSearch(paths),
    });

    for (const path of paths) {
      await fs.writeAtomic(path, 'seed');
    }

    const started = performance.now();
    const result = await appendFileMulti(
      { pattern: '**/*.txt', content: 'X' },
      runtime,
    );
    const elapsed = performance.now() - started;

    assert.equal(result.status, 'success');
    assert.ok(elapsed < 2000, `append_file_multi took ${elapsed.toFixed(1)}ms`);
    assert.equal(await fs.readText('bulk/file-0.txt'), 'seed\n\nX');
  });

  it('refuses a 101-file batch before any filesystem I/O', async () => {
    const runtime: FilesystemRuntime = {
      getFileSystem: (): IBrudFileSystem => {
        throw new Error('filesystem must not be touched');
      },
      getUniversalHistory: (): IUniversalHistoryService => {
        throw new Error('history must not be touched');
      },
      executeTool: fakeSearch(
        Array.from({ length: 101 }, (_, index) => `file-${index}.txt`),
      ),
      mutex: SHARED_MUTEX,
      workspaceRoot: '/workspace',
    };

    const result = await appendFileMulti(
      { pattern: '**/*.txt', content: 'X' },
      runtime,
    );

    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
  });
});