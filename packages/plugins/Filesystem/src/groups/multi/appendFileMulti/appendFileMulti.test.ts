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
import { appendFileMulti } from './appendFileMulti.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

async function seed(): Promise<string[]> {
  const paths = ['a.txt', 'b.txt'];

  await kernel.fs.writeAtomic('a.txt', 'A');
  await kernel.fs.writeAtomic('b.txt', 'B');

  return paths;
}

describe('append_file_multi', () => {
  it('appends to every matching file', async () => {
    const paths = await seed();
    const result = await appendFileMulti(
      { pattern: '*.txt', content: 'X' },
      createRuntime(kernel, fakeSearch(paths)),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'A\n\nX');
    assert.equal(await kernel.fs.readText('b.txt'), 'B\n\nX');
    assert.equal(mutationData(result).files.length, 2);
  });

  it('respects position start', async () => {
    await seed();
    const result = await appendFileMulti(
      { pattern: '*.txt', position: 'start', content: 'X' },
      createRuntime(kernel, fakeSearch(['a.txt'])),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'X\n\nA');
  });

  it('fails with BATCH_LIMIT_EXCEEDED at 101 files before any write', async () => {
    await kernel.fs.writeAtomic('a.txt', 'A');
    const paths = Array.from({ length: 101 }, (_, index) => `file-${index}.txt`);

    const result = await appendFileMulti(
      { pattern: '*.txt', content: 'X' },
      createRuntime(kernel, fakeSearch(paths)),
    );

    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
    assert.equal(await kernel.fs.readText('a.txt'), 'A');
  });

  it('skips a candidate that cannot be read', async () => {
    await kernel.fs.writeAtomic('a.txt', 'A');

    const result = await appendFileMulti(
      { pattern: '*.txt', content: 'X' },
      createRuntime(kernel, fakeSearch(['a.txt', 'missing.txt'])),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'A\n\nX');
    assert.deepEqual(
      mutationData(result).skipped.map((entry) => entry.path),
      ['missing.txt'],
    );
  });

  it('captures the pre-state of every candidate', async () => {
    const paths = await seed();
    const result = await appendFileMulti(
      { pattern: '*.txt', content: 'X' },
      createRuntime(kernel, fakeSearch(paths)),
    );

    assert.deepEqual(
      mutationData(result).preState?.map((entry) => entry.path).sort(),
      ['a.txt', 'b.txt'],
    );
  });
});