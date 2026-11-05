import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BYTES_PER_MUTATION,
  MAX_CONCURRENCY,
  MAX_DIRECTORY_DEPTH,
  MAX_FILES_PER_MUTATION,
  checkBatch,
  checkBytes,
  checkDepth,
  runWithConcurrency,
} from './index.js';

function files(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `file-${index}.txt`);
}

function depthPath(depth: number): string {
  return Array.from({ length: depth }, (_, index) => `d${index}`).join('/');
}

describe('mutation governor', () => {
  it('allows 99 and 100 files and refuses 101', () => {
    assert.equal(checkBatch(files(99)).ok, true);
    assert.equal(checkBatch(files(100)).ok, true);

    const refused = checkBatch(files(101));

    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'BATCH_LIMIT_EXCEEDED');
    assert.equal(refused.limit, MAX_FILES_PER_MUTATION);
    assert.equal(refused.requested, 101);
  });

  it('allows depth 32 and refuses depth 33', () => {
    assert.equal(checkDepth(depthPath(32)).ok, true);

    const refused = checkDepth(depthPath(33));

    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'DEPTH_LIMIT_EXCEEDED');
    assert.equal(refused.limit, MAX_DIRECTORY_DEPTH);
  });

  it('allows the byte ceiling and refuses one byte more', () => {
    assert.equal(checkBytes(MAX_BYTES_PER_MUTATION - 1).ok, true);
    assert.equal(checkBytes(MAX_BYTES_PER_MUTATION).ok, true);

    const refused = checkBytes(MAX_BYTES_PER_MUTATION + 1);

    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'BYTE_LIMIT_EXCEEDED');
    assert.equal(refused.limit, MAX_BYTES_PER_MUTATION);
  });

  it('never runs more than MAX_CONCURRENCY workers at once', async () => {
    let inFlight = 0;
    let peak = 0;

    const results = await runWithConcurrency(
      Array.from({ length: 40 }, (_, index) => index),
      32,
      async (value) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;

        return value * 2;
      },
    );

    assert.ok(peak <= MAX_CONCURRENCY, `peak concurrency was ${peak}`);
    assert.ok(peak > 1, 'workers should run concurrently');
    assert.deepEqual(
      results,
      Array.from({ length: 40 }, (_, index) => index * 2),
      'results must preserve input order',
    );
  });
});