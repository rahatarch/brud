import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { moveFile } from './moveFile.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('move_file', () => {
  it('moves a file across directories and creates the destination parent', async () => {
    await kernel.fs.writeAtomic('a.txt', 'content');

    const result = await moveFile(
      { from: 'a.txt', to: 'nested/deep/b.txt' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.exists('a.txt'), false);
    assert.equal(await kernel.fs.readText('nested/deep/b.txt'), 'content');
  });

  it('returns FILE_NOT_FOUND for a missing source', async () => {
    const result = await moveFile(
      { from: 'missing.txt', to: 'b.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'FILE_NOT_FOUND');
  });

  it('returns CONFLICT for an existing destination', async () => {
    await kernel.fs.writeAtomic('a.txt', 'a');
    await kernel.fs.writeAtomic('b.txt', 'b');

    const result = await moveFile(
      { from: 'a.txt', to: 'b.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'CONFLICT');
  });
});