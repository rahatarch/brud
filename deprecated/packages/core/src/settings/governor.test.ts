import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  BINARY_SAMPLE_BYTES,
  DEFAULT_READ_CONCURRENCY,
  DEFAULT_SETTINGS,
  HARD_MAX_AGGREGATE_BYTES,
  MAX_AGGREGATE_BYTES,
  MAX_BATCH_FILES,
  MAX_READ_CONCURRENCY,
} from './types';

describe('read governor limits', () => {
  it('exposes the ratified constants', () => {
    assert.strictEqual(MAX_BATCH_FILES, 100);
    assert.strictEqual(MAX_AGGREGATE_BYTES, 8 * 1024 * 1024);
    assert.strictEqual(HARD_MAX_AGGREGATE_BYTES, 32 * 1024 * 1024);
    assert.strictEqual(MAX_READ_CONCURRENCY, 32);
    assert.strictEqual(DEFAULT_READ_CONCURRENCY, 16);
    assert.strictEqual(BINARY_SAMPLE_BYTES, 8192);
  });

  it('keeps the default concurrency within the hard ceiling', () => {
    assert.ok(DEFAULT_READ_CONCURRENCY <= MAX_READ_CONCURRENCY);
    assert.ok(MAX_AGGREGATE_BYTES <= HARD_MAX_AGGREGATE_BYTES);
  });

  it('carries the governor defaults on DEFAULT_SETTINGS', () => {
    assert.strictEqual(DEFAULT_SETTINGS.readConcurrency, DEFAULT_READ_CONCURRENCY);
    assert.strictEqual(DEFAULT_SETTINGS.readMaxBatchFiles, MAX_BATCH_FILES);
    assert.strictEqual(DEFAULT_SETTINGS.readMaxAggregateBytes, MAX_AGGREGATE_BYTES);
  });
});
