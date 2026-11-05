import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { appendFile } from './appendFile.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('append_file', () => {
  it('appends to the end by default', async () => {
    await kernel.fs.writeAtomic('a.txt', 'first');

    const result = await appendFile(
      { path: 'a.txt', content: 'second' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'first\n\nsecond');
    assert.deepEqual(mutationData(result).files, [{ path: 'a.txt', status: 'appended' }]);
  });

  it('prepends to the start', async () => {
    await kernel.fs.writeAtomic('a.txt', 'first');

    await appendFile(
      { path: 'a.txt', position: 'start', content: 'zero' },
      createRuntime(kernel),
    );

    assert.equal(await kernel.fs.readText('a.txt'), 'zero\n\nfirst');
  });

  it('returns FILE_NOT_FOUND for a missing file', async () => {
    const result = await appendFile(
      { path: 'missing.txt', content: 'x' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'FILE_NOT_FOUND');
  });

  it('captures the full pre-state', async () => {
    await kernel.fs.writeAtomic('a.txt', 'before');

    const result = await appendFile(
      { path: 'a.txt', content: 'after' },
      createRuntime(kernel),
    );

    assert.deepEqual(mutationData(result).preState, [
      { path: 'a.txt', status: 'file', content: 'before', size: 6 },
    ]);
  });
});