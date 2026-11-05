import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTestKernel,
  createRuntime,
  errorCode,
  mutationData,
} from '../../../__tests__/support/testHarness.js';
import type { TestKernel } from '../../../__tests__/support/testHarness.js';
import { searchReplace } from './searchReplace.js';

let kernel: TestKernel;

beforeEach(async () => {
  kernel = await bootTestKernel();
});

afterEach(async () => {
  await kernel.shutdown();
});

describe('search_replace', () => {
  it('replaces a single match', async () => {
    await kernel.fs.writeAtomic('a.txt', 'alpha beta alpha');

    const result = await searchReplace(
      { path: 'a.txt', search: 'beta', replace: 'BETA' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), 'alpha BETA alpha');
  });

  it('returns SEARCH_NOT_FOUND for zero matches', async () => {
    await kernel.fs.writeAtomic('a.txt', 'alpha');

    const result = await searchReplace(
      { path: 'a.txt', search: 'missing', replace: 'x' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'SEARCH_NOT_FOUND');
    assert.equal(await kernel.fs.readText('a.txt'), 'alpha');
  });

  it('returns MULTIPLE_MATCHES for more than one match', async () => {
    await kernel.fs.writeAtomic('a.txt', 'foo foo');

    const result = await searchReplace(
      { path: 'a.txt', search: 'foo', replace: 'bar' },
      createRuntime(kernel),
    );

    assert.equal(errorCode(result), 'MULTIPLE_MATCHES');
  });

  it('captures the full pre-state', async () => {
    await kernel.fs.writeAtomic('a.txt', 'alpha beta');

    const result = await searchReplace(
      { path: 'a.txt', search: 'beta', replace: 'BETA' },
      createRuntime(kernel),
    );

    assert.deepEqual(mutationData(result).preState, [
      { path: 'a.txt', status: 'file', content: 'alpha beta', size: 10 },
    ]);
  });

  it('strips numeric line prefixes from the search text', async () => {
    await kernel.fs.writeAtomic('a.txt', '1 | hello\n2 | world');

    const result = await searchReplace(
      { path: 'a.txt', search: '1 | hello', replace: 'hi' },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await kernel.fs.readText('a.txt'), '1 | hi\n2 | world');
  });
});