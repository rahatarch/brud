import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { renameFile } from './renameFile.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('rename_file', () => {
  it('renames a real file', async () => {
    await kernel.fs.writeAtomic('old.txt', 'content');

    const result = await renameFile(
      { from: 'old.txt', to: 'new.txt' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.exists('old.txt'), false);
    assert.equal(await kernel.fs.readText('new.txt'), 'content');
  });

  it('returns FILE_NOT_FOUND for a missing source', async () => {
    const result = await renameFile(
      { from: 'missing.txt', to: 'new.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'FILE_NOT_FOUND');
  });

  it('returns CONFLICT for an existing destination', async () => {
    await kernel.fs.writeAtomic('a.txt', 'a');
    await kernel.fs.writeAtomic('b.txt', 'b');

    const result = await renameFile(
      { from: 'a.txt', to: 'b.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'CONFLICT');
    assert.equal(await kernel.fs.readText('a.txt'), 'a');
    assert.equal(await kernel.fs.readText('b.txt'), 'b');
  });

  it('captures both pre-states', async () => {
    await kernel.fs.writeAtomic('a.txt', 'a');

    const result = await renameFile(
      { from: 'a.txt', to: 'b.txt' },
      createRuntime(kernel),
    );

    assert.deepEqual(mutationData(result).preState, [
      { path: 'a.txt', status: 'file', content: 'a', size: 1 },
      { path: 'b.txt', status: 'missing' },
    ]);
  });
});