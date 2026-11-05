import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  fakeSearch,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { searchReplaceMulti } from './searchReplaceMulti.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('search_replace_multi', () => {
  it('replaces across multiple files', async () => {
    await kernel.fs.writeAtomic('a.txt', 'foo');
    await kernel.fs.writeAtomic('b.txt', 'foo');

    const result = await searchReplaceMulti(
      { pattern: '*.txt', search: 'foo', replace: 'bar' },
      createRuntime(kernel, fakeSearch(['a.txt', 'b.txt'])),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'bar');
    assert.equal(await kernel.fs.readText('b.txt'), 'bar');
    assert.equal(mutationData(result).files.length, 2);
  });

  it('skips files with zero matches without failing the batch', async () => {
    await kernel.fs.writeAtomic('a.txt', 'foo');
    await kernel.fs.writeAtomic('b.txt', 'nope');

    const result = await searchReplaceMulti(
      { pattern: '*.txt', search: 'foo', replace: 'bar' },
      createRuntime(kernel, fakeSearch(['a.txt', 'b.txt'])),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('b.txt'), 'nope');
    assert.deepEqual(
      mutationData(result).skipped.map((entry) => entry.code),
      ['SEARCH_NOT_FOUND'],
    );
  });

  it('skips files with multiple matches with the reason', async () => {
    await kernel.fs.writeAtomic('a.txt', 'foo foo');

    const result = await searchReplaceMulti(
      { pattern: '*.txt', search: 'foo', replace: 'bar' },
      createRuntime(kernel, fakeSearch(['a.txt'])),
    );

    assert.equal(result.status, 'success');
    assert.equal(mutationData(result).skipped[0]?.code, 'MULTIPLE_MATCHES');
    assert.equal(await kernel.fs.readText('a.txt'), 'foo foo');
  });

  it('fails with BATCH_LIMIT_EXCEEDED at 101 files', async () => {
    const paths = Array.from({ length: 101 }, (_, index) => `file-${index}.txt`);

    const result = await searchReplaceMulti(
      { pattern: '*.txt', search: 'foo', replace: 'bar' },
      createRuntime(kernel, fakeSearch(paths)),
    );

    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
  });

  it('captures the pre-state of every candidate', async () => {
    await kernel.fs.writeAtomic('a.txt', 'foo');
    await kernel.fs.writeAtomic('b.txt', 'foo');

    const result = await searchReplaceMulti(
      { pattern: '*.txt', search: 'foo', replace: 'bar' },
      createRuntime(kernel, fakeSearch(['a.txt', 'b.txt'])),
    );

    assert.deepEqual(
      mutationData(result).preState?.map((entry) => entry.path).sort(),
      ['a.txt', 'b.txt'],
    );
  });
});