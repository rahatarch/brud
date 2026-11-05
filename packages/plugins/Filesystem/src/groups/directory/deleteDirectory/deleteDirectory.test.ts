import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { deleteDirectory } from './deleteDirectory.js';

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

describe('delete_directory', () => {
  it('deletes a nested tree recursively', async () => {
    await seedTree();

    const result = await deleteDirectory(
      { directoryPath: 'tree' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.stat('tree'), null);
  });

  it('is idempotent on a missing directory', async () => {
    const result = await deleteDirectory(
      { directoryPath: 'ghost' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(mutationData(result).skipped.length, 1);
    assert.match(result.message ?? '', /does not exist\. Nothing to delete\./u);
  });

  it('refuses a file with CANNOT_DELETE_FILE_AS_DIRECTORY', async () => {
    await kernel.fs.writeAtomic('file.txt', 'x');

    const result = await deleteDirectory(
      { directoryPath: 'file.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'CANNOT_DELETE_FILE_AS_DIRECTORY');
    assert.equal(await kernel.fs.readText('file.txt'), 'x');
  });

  it('captures pre-state for every contained file', async () => {
    await seedTree();

    const result = await deleteDirectory(
      { directoryPath: 'tree' },
      createRuntime(kernel),
    );
    const files = mutationData(result).preState
      ?.filter((entry) => entry.status === 'file')
      .map((entry) => entry.path)
      .sort();

    assert.deepEqual(files, ['tree/a.txt', 'tree/sub/b.txt']);
  });

  it('records a reversible deletion', async () => {
    await seedTree();

    const result = await deleteDirectory(
      { directoryPath: 'tree' },
      createRuntime(kernel),
    );
    const sessionId = mutationData(result).sessionId;

    assert.ok(sessionId);
    assert.equal(await kernel.fs.exists('tree/a.txt'), false);

    const plan = await kernel.history.planReversal(sessionId);

    assert.equal(plan.isExecutable, true);
    await kernel.history.executeReversal(plan);
    assert.equal(await kernel.fs.readText('tree/a.txt'), 'a');
    assert.equal(await kernel.fs.readText('tree/sub/b.txt'), 'b');
  });
});