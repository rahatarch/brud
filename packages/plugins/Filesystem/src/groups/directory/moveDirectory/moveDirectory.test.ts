import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { moveDirectory } from './moveDirectory.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

async function seedTree(): Promise<void> {
  await kernel.fs.writeAtomic('tree/a.txt', 'a');
  await kernel.fs.writeAtomic('tree/sub/b.txt', 'b');
}

describe('move_directory', () => {
  it('moves a directory and its contents', async () => {
    await seedTree();

    const result = await moveDirectory(
      { from: 'tree', to: 'moved' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.exists('tree'), false);
    assert.equal(await kernel.fs.readText('moved/a.txt'), 'a');
    assert.equal(await kernel.fs.readText('moved/sub/b.txt'), 'b');
  });

  it('returns DIRECTORY_NOT_FOUND for a missing source', async () => {
    const result = await moveDirectory(
      { from: 'ghost', to: 'moved' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'DIRECTORY_NOT_FOUND');
  });

  it('returns CONFLICT for an existing destination', async () => {
    await kernel.fs.createDirectory('tree');
    await kernel.fs.createDirectory('taken');

    const result = await moveDirectory(
      { from: 'tree', to: 'taken' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'CONFLICT');
  });

  it('captures pre-state for every contained file', async () => {
    await seedTree();

    const result = await moveDirectory(
      { from: 'tree', to: 'moved' },
      createRuntime(kernel),
    );
    const files = mutationData(result).preState
      ?.filter((entry) => entry.status === 'file')
      .map((entry) => entry.path)
      .sort();

    assert.deepEqual(files, ['tree/a.txt', 'tree/sub/b.txt']);
  });
});