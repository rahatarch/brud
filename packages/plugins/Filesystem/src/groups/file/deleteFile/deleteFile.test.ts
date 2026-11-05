import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { deleteFile } from './deleteFile.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('delete_file', () => {
  it('deletes a real file', async () => {
    await kernel.fs.writeAtomic('a.txt', 'content');

    const result = await deleteFile({ path: 'a.txt' }, createRuntime(kernel));

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.stat('a.txt'), null);
  });

  it('returns success with a skip when the file is missing', async () => {
    const result = await deleteFile({ path: 'ghost.txt' }, createRuntime(kernel));

    assert.equal(result.status, 'success');
    assert.equal(mutationData(result).skipped.length, 1);
    assert.match(result.message ?? '', /does not exist\. Nothing to delete\./u);
  });

  it('rejects protected paths', async () => {
    const result = await deleteFile(
      { path: '.brud/settings.json' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'PROTECTED_PATH_DENIED');
  });

  it('records a reversible deletion', async () => {
    await kernel.fs.writeAtomic('restore-me.txt', 'restore me');
    const runtime = createRuntime(kernel);

    const result = await deleteFile({ path: 'restore-me.txt' }, runtime);
    const sessionId = mutationData(result).sessionId;

    assert.ok(sessionId);
    assert.equal(await kernel.fs.exists('restore-me.txt'), false);

    const plan = await kernel.history.planReversal(sessionId);

    assert.equal(plan.isExecutable, true);
    await kernel.history.executeReversal(plan);
    assert.equal(await kernel.fs.readText('restore-me.txt'), 'restore me');
  });
});