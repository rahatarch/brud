import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { createFile } from './createFile.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('create_file', () => {
  it('creates a real file', async () => {
    const result = await createFile(
      { path: 'src/hello.txt', content: 'hello' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('src/hello.txt'), 'hello');
    assert.equal(mutationData(result).files[0]?.status, 'created');
  });

  it('rejects an existing file with CONFLICT and leaves it unchanged', async () => {
    await kernel.fs.writeAtomic('a.txt', 'original');

    const result = await createFile(
      { path: 'a.txt', content: 'replacement' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'CONFLICT');
    assert.equal(await kernel.fs.readText('a.txt'), 'original');
  });

  it('rejects protected paths', async () => {
    const result = await createFile(
      { path: '.brud/settings.json', content: '{}' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'PROTECTED_PATH_DENIED');
  });

  it('rejects traversal', async () => {
    const result = await createFile(
      { path: '../../../etc/passwd', content: 'x' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'WORKSPACE_PATH_VIOLATION');
  });

  it('records a completed session on success', async () => {
    const result = await createFile(
      { path: 'tracked.txt', content: 'tracked' },
      createRuntime(kernel),
    );
    const sessionId = mutationData(result).sessionId;

    assert.ok(sessionId);
    assert.equal((await kernel.history.getSession(sessionId))?.status, 'committed');
  });

  it('aborts the session on failure', async () => {
    await kernel.fs.writeAtomic('taken.txt', 'taken');

    const result = await createFile(
      { path: 'taken.txt', content: 'new' },
      createRuntime(kernel),
    );
    const sessionId = mutationData(result).sessionId;

    assert.ok(sessionId);
    assert.equal((await kernel.history.getSession(sessionId))?.status, 'aborted');
  });

  it('captures a missing pre-state for the created file', async () => {
    const result = await createFile(
      { path: 'fresh.txt', content: 'fresh' },
      createRuntime(kernel),
    );

    assert.deepEqual(mutationData(result).preState, [
      { path: 'fresh.txt', status: 'missing' },
    ]);
  });
});