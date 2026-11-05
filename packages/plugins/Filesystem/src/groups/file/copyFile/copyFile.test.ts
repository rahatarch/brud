import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { copyFile } from './copyFile.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('copy_file', () => {
  it('copies a real file', async () => {
    await kernel.fs.writeAtomic('a.txt', 'content');

    const result = await copyFile(
      { from: 'a.txt', to: 'dir/b.txt' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'content');
    assert.equal(await kernel.fs.readText('dir/b.txt'), 'content');
  });

  it('preserves the source mode', async () => {
    await kernel.fs.writeAtomic('exec.sh', '#!/bin/sh\n');
    await chmod(join(kernel.root, 'exec.sh'), 0o755);

    const result = await copyFile(
      { from: 'exec.sh', to: 'exec-copy.sh' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    const stats = await kernel.fs.stat('exec-copy.sh');

    assert.ok(stats);
    assert.equal(stats.mode === undefined ? undefined : stats.mode & 0o777, 0o755);
  });

  it('returns FILE_NOT_FOUND for a missing source', async () => {
    const result = await copyFile(
      { from: 'missing.txt', to: 'b.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'FILE_NOT_FOUND');
  });

  it('returns CONFLICT for an existing destination', async () => {
    await kernel.fs.writeAtomic('a.txt', 'a');
    await kernel.fs.writeAtomic('b.txt', 'b');

    const result = await copyFile(
      { from: 'a.txt', to: 'b.txt' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'CONFLICT');
  });
});