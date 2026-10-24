import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrudError, batchLimitExceededError, isBrudError } from './errors';
import { BrudAPI, batchLimitExceededError as batchLimitExceededErrorFromBarrel } from './index';

describe('batchLimitExceededError', () => {
  it('returns BATCH_LIMIT_EXCEEDED with deterministic counts', () => {
    const error = batchLimitExceededError(1600, 100);

    assert.strictEqual(error.code, 'BATCH_LIMIT_EXCEEDED');
    assert.strictEqual(error.friendly, 'Read batch too large.');
    assert.strictEqual(
      error.message,
      'Batch file count (1600) exceeds maximum threshold (100). Narrow the pattern, add excludePatterns, or split the read into sequential batches of 100 or fewer.',
    );
    assert.strictEqual(
      error.details,
      'Requested 1600 files; the limit is 100 per batch. Narrow the pattern, add excludePatterns, or split the read into sequential batches of 100 or fewer.',
    );
    assert.strictEqual(error.path, undefined);
    assert.strictEqual(error.command, undefined);
  });

  it('interpolates the requested count and the limit independently', () => {
    const error = batchLimitExceededError(101, 50);

    assert.ok(error.details.includes('Requested 101 files'));
    assert.ok(error.details.includes('the limit is 50 per batch'));
    assert.ok(error.details.includes('batches of 50 or fewer'));
    assert.ok(!error.details.includes('100'));
  });

  it('produces identical text for identical input', () => {
    assert.deepStrictEqual(batchLimitExceededError(1600, 100), batchLimitExceededError(1600, 100));
  });

  it('is re-exported from the api barrel', () => {
    assert.strictEqual(batchLimitExceededErrorFromBarrel, batchLimitExceededError);
  });

  it('is reachable as BrudAPI.errors.batchLimitExceededError', () => {
    assert.strictEqual(BrudAPI.errors.batchLimitExceededError, batchLimitExceededError);
    assert.strictEqual(
      BrudAPI.errors.batchLimitExceededError(1600, 100).code,
      'BATCH_LIMIT_EXCEEDED',
    );
  });
});

describe('BrudError class', () => {
  it('inherits from Error and exposes the standard error surface', () => {
    const error = batchLimitExceededError(1600, 100);

    assert.ok(error instanceof Error);
    assert.ok(error instanceof Object);
    assert.ok(error instanceof BrudError);
    assert.strictEqual(Object.getPrototypeOf(error), BrudError.prototype);
    assert.strictEqual(error.name, 'BrudError');
    assert.strictEqual(typeof error.message, 'string');
    assert.strictEqual(error.message, 'Batch file count (1600) exceeds maximum threshold (100). Narrow the pattern, add excludePatterns, or split the read into sequential batches of 100 or fewer.');
    assert.strictEqual(typeof error.stack, 'string');
    assert.ok((error.stack ?? '').length > 0);
  });

  it('keeps the structured fields on the instance', () => {
    const error = batchLimitExceededError(1600, 100);
    assert.strictEqual(error.code, 'BATCH_LIMIT_EXCEEDED');
    assert.strictEqual(error.friendly, 'Read batch too large.');
    assert.ok(error.details.includes('Requested 1600 files'));
  });

  it('serializes its structured fields to JSON', () => {
    const parsed = JSON.parse(JSON.stringify(batchLimitExceededError(7, 5))) as Record<string, unknown>;
    assert.strictEqual(parsed.code, 'BATCH_LIMIT_EXCEEDED');
    assert.strictEqual(parsed.friendly, 'Read batch too large.');
    assert.strictEqual(typeof parsed.details, 'string');
  });
});

describe('isBrudError', () => {
  it('accepts factory output', () => {
    assert.strictEqual(isBrudError(batchLimitExceededError(1, 2)), true);
  });

  it('accepts structurally complete plain objects', () => {
    assert.strictEqual(isBrudError({ code: 'X', friendly: 'y', details: 'z' }), true);
  });

  it('rejects native errors and arbitrary values', () => {
    assert.strictEqual(isBrudError(new Error('native')), false);
    assert.strictEqual(isBrudError({}), false);
    assert.strictEqual(isBrudError({ code: 'X', friendly: 'y' }), false);
    assert.strictEqual(isBrudError({ code: 'X', details: 'z' }), false);
    assert.strictEqual(isBrudError(null), false);
    assert.strictEqual(isBrudError(undefined), false);
    assert.strictEqual(isBrudError('BATCH_LIMIT_EXCEEDED'), false);
    assert.strictEqual(isBrudError(42), false);
  });
});
