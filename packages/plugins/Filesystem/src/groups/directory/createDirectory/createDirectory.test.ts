import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { createDirectory } from './createDirectory.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('create_directory', () => {
  it('creates an empty directory', async () => {
    const result = await createDirectory(
      { directoryPath: 'newdir' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    const stats = await kernel.fs.stat('newdir');

    assert.ok(stats);
    assert.equal(stats.isDirectory, true);
  });

  it('is idempotent on an existing directory', async () => {
    await kernel.fs.createDirectory('existing');

    const first = await createDirectory(
      { directoryPath: 'existing' },
      createRuntime(kernel),
    );
    const second = await createDirectory(
      { directoryPath: 'existing' },
      createRuntime(kernel),
    );

    assert.equal(first.status, 'success');
    assert.equal(second.status, 'success');
  });

  it('creates optional empty files inside', async () => {
    const result = await createDirectory(
      { directoryPath: 'pkg', files: ['index.ts', 'sub/module.ts'] },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('pkg/index.ts'), '');
    assert.equal(await kernel.fs.readText('pkg/sub/module.ts'), '');
    assert.equal(mutationData(result).files.length, 2);
  });

  it('rejects protected paths', async () => {
    const result = await createDirectory(
      { directoryPath: '.git' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'PROTECTED_PATH_DENIED');
  });

  it('records the created files in a completed session', async () => {
    const result = await createDirectory(
      { directoryPath: 'tracked', files: ['a.txt'] },
      createRuntime(kernel),
    );
    const sessionId = mutationData(result).sessionId;

    assert.ok(sessionId);
    const session = await kernel.history.getSession(sessionId);

    assert.equal(session?.status, 'committed');
    // The directory node is a reversible session target, so it is declared
    // alongside the file it contains.
    assert.deepEqual([...(session?.filesAffected ?? [])].sort(), [
      'tracked',
      'tracked/a.txt',
    ]);
  });
});