import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFailureEnvelope,
  buildPartialEnvelope,
  buildSkipEntry,
  buildSuccessEnvelope,
} from './index.js';

describe('mutation envelopes', () => {
  it('builds a success envelope', () => {
    const file = { path: 'a.txt', status: 'created' as const };
    const envelope = buildSuccessEnvelope('create_file', [file], {
      sessionId: 'BR-20260101-001',
      message: 'Created a.txt.',
      preState: [{ path: 'a.txt', status: 'missing' }],
    });

    assert.deepEqual(envelope, {
      kind: 'create_file',
      status: 'success',
      message: 'Created a.txt.',
      files: [file],
      skipped: [],
      errors: [],
      sessionId: 'BR-20260101-001',
      preState: [{ path: 'a.txt', status: 'missing' }],
    });
  });

  it('builds a partial envelope with skips', () => {
    const skip = buildSkipEntry('b.txt', 'Search text was not found.', 'SEARCH_NOT_FOUND');
    const envelope = buildPartialEnvelope(
      'search_replace_multi',
      [{ path: 'a.txt', status: 'replaced' }],
      [skip],
    );

    assert.equal(envelope.status, 'partial');
    assert.deepEqual(envelope.files, [{ path: 'a.txt', status: 'replaced' }]);
    assert.deepEqual(envelope.skipped, [skip]);
    assert.deepEqual(envelope.errors, []);
  });

  it('builds a failure envelope', () => {
    const envelope = buildFailureEnvelope('create_file', [{
      code: 'CONFLICT',
      message: 'File already exists.',
      path: 'a.txt',
    }]);

    assert.equal(envelope.status, 'failed');
    assert.equal(envelope.message, 'File already exists.');
    assert.deepEqual(envelope.files, []);
    assert.deepEqual(envelope.skipped, []);
    assert.equal(envelope.errors[0]?.code, 'CONFLICT');
  });

  it('builds skip entries with and without codes', () => {
    assert.deepEqual(buildSkipEntry('a.txt', 'skipped'), {
      path: 'a.txt',
      reason: 'skipped',
    });
    assert.deepEqual(buildSkipEntry('a.txt', 'skipped', 'FILE_NOT_FOUND'), {
      path: 'a.txt',
      reason: 'skipped',
      code: 'FILE_NOT_FOUND',
    });
  });
});