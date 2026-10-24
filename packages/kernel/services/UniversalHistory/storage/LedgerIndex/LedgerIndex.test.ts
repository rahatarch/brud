import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionManifest, TargetDigest } from '../../contracts/IUniversalHistoryService/types.js';
import { LedgerIndex } from './LedgerIndex.js';

function digest(relativePath: string): TargetDigest {
  return {
    relativePath,
    sha256: '0'.repeat(64),
    sizeBytes: 0,
    isBinary: false,
    exists: true,
  };
}

function manifest(
  sessionId: string,
  createdAt: string,
  overrides: Partial<SessionManifest> = {},
): SessionManifest {
  return {
    schemaVersion: 1,
    sessionId,
    createdAt,
    prompt: `prompt ${sessionId}`,
    status: 'active',
    filesAffected: ['src/index.ts'],
    preDigests: { 'src/index.ts': digest('src/index.ts') },
    postDigests: {},
    ...overrides,
  };
}

function ids(manifests: readonly SessionManifest[]): readonly string[] {
  return manifests.map((entry) => entry.sessionId);
}

describe('LedgerIndex', () => {
  it('retrieves manifests by id', () => {
    const index = new LedgerIndex();
    const entry = manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z');

    index.upsert(entry);

    assert.equal(index.get('BR-20260101-001'), entry);
    assert.equal(index.get('BR-20260101-999'), undefined);
    assert.equal(index.size, 1);
  });

  it('returns manifests newest first regardless of insertion order', () => {
    const index = new LedgerIndex();

    index.upsert(manifest('BR-20260102-001', '2026-01-02T00:00:00.000Z'));
    index.upsert(manifest('BR-20260104-001', '2026-01-04T00:00:00.000Z'));
    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z'));
    index.upsert(manifest('BR-20260103-001', '2026-01-03T00:00:00.000Z'));

    assert.deepEqual(ids(index.list()), [
      'BR-20260104-001',
      'BR-20260103-001',
      'BR-20260102-001',
      'BR-20260101-001',
    ]);
  });

  it('breaks createdAt ties by session id', () => {
    const index = new LedgerIndex();
    const createdAt = '2026-01-01T00:00:00.000Z';

    index.upsert(manifest('BR-20260101-002', createdAt));
    index.upsert(manifest('BR-20260101-001', createdAt));
    index.upsert(manifest('BR-20260101-003', createdAt));

    assert.deepEqual(ids(index.list()), [
      'BR-20260101-003',
      'BR-20260101-002',
      'BR-20260101-001',
    ]);
  });

  it('does not duplicate manifests on upsert', () => {
    const index = new LedgerIndex();

    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z'));
    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z', { status: 'committed' }));

    assert.equal(index.size, 1);
    assert.equal(index.list().length, 1);
    assert.equal(index.get('BR-20260101-001')?.status, 'committed');
  });

  it('repositions manifests whose createdAt changes', () => {
    const index = new LedgerIndex();

    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z'));
    index.upsert(manifest('BR-20260101-002', '2026-01-02T00:00:00.000Z'));
    index.upsert(manifest('BR-20260101-001', '2026-01-03T00:00:00.000Z'));

    assert.deepEqual(ids(index.list()), ['BR-20260101-001', 'BR-20260101-002']);
  });

  it('hides soft-deleted manifests by default', () => {
    const index = new LedgerIndex();

    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z'));
    index.upsert(manifest('BR-20260101-002', '2026-01-02T00:00:00.000Z', {
      isDeleted: true,
      deletedAt: '2026-01-05T00:00:00.000Z',
    }));

    assert.deepEqual(ids(index.list()), ['BR-20260101-001']);
    assert.deepEqual(ids(index.list({ includeDeleted: true })), [
      'BR-20260101-002',
      'BR-20260101-001',
    ]);
    assert.equal(index.size, 2);
  });

  it('applies pagination limits to newest entries', () => {
    const index = new LedgerIndex();

    for (let day = 1; day <= 5; day += 1) {
      const padded = day.toString().padStart(2, '0');
      index.upsert(manifest(`BR-202601${padded}-001`, `2026-01-${padded}T00:00:00.000Z`));
    }

    assert.deepEqual(ids(index.list({ limit: 2 })), [
      'BR-20260105-001',
      'BR-20260104-001',
    ]);
    assert.deepEqual(ids(index.list({ limit: 0 })), []);
    assert.equal(index.list({ limit: 99 }).length, 5);
  });

  it('filters by an inclusive time range', () => {
    const index = new LedgerIndex();

    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z'));
    index.upsert(manifest('BR-20260102-001', '2026-01-02T00:00:00.000Z'));
    index.upsert(manifest('BR-20260103-001', '2026-01-03T00:00:00.000Z'));

    assert.deepEqual(
      ids(index.list({
        timeRange: {
          from: '2026-01-02T00:00:00.000Z',
          to: '2026-01-03T00:00:00.000Z',
        },
      })),
      ['BR-20260103-001', 'BR-20260102-001'],
    );

    assert.deepEqual(
      ids(index.list({ timeRange: { from: '2026-01-03T00:00:00.000Z' } })),
      ['BR-20260103-001'],
    );

    assert.deepEqual(
      ids(index.list({ timeRange: { to: '2026-01-01T00:00:00.000Z' } })),
      ['BR-20260101-001'],
    );
  });

  it('rejects invalid time range bounds', () => {
    const index = new LedgerIndex();

    assert.throws(() => index.list({ timeRange: { from: 'not-a-date' } }), RangeError);
  });

  it('clears all state', () => {
    const index = new LedgerIndex();
    index.upsert(manifest('BR-20260101-001', '2026-01-01T00:00:00.000Z'));

    index.clear();

    assert.equal(index.size, 0);
    assert.deepEqual(index.list(), []);
  });
});
