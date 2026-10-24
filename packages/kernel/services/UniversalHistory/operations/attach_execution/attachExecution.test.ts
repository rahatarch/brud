import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import type { TargetDigest } from '../../contracts/IUniversalHistoryService/types.js';
import { captureBaseline } from '../capture_baseline/captureBaseline.js';
import { computeDelta } from '../compute_delta/computeDelta.js';
import type { FileDelta } from '../compute_delta/types.js';
import {
  attachExecution,
  createSessionExecutionState,
} from './attachExecution.js';
import { InactiveSessionError } from './types.js';

const SESSION_ID = 'BR-20260131-001';

interface Harness {
  readonly fileSystem: BrudFileSystem;
  readonly driver: InMemoryStorageDriver;
}

async function createHarness(): Promise<Harness> {
  const driver = new InMemoryStorageDriver();
  const fileSystem = new BrudFileSystem('/workspace', driver);
  await fileSystem.initialize();
  return { fileSystem, driver };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function missingDigest(relativePath: string): TargetDigest {
  return {
    relativePath,
    sha256: '',
    sizeBytes: 0,
    isBinary: false,
    exists: false,
  };
}

async function deltaFor(
  fileSystem: BrudFileSystem,
  relativePath: string,
  baseline: TargetDigest,
  beforeText?: string,
): Promise<FileDelta> {
  return computeDelta({
    fileSystem,
    relativePath,
    baseline,
    baselinePayload: beforeText === undefined
      ? undefined
      : { text: beforeText, digest: baseline },
  });
}

describe('attachExecution', () => {
  it('preserves the turn-1 baseline across multi-turn edits', async () => {
    const { fileSystem } = await createHarness();
    const relativePath = 'src/app.ts';
    const original = 'version 1\n';
    await fileSystem.createFile(relativePath, original);

    const baseline = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: [relativePath],
      capturedAt: '2026-01-31T12:00:00.000Z',
    });

    await fileSystem.writeAtomic(relativePath, 'version 2\n');
    const first = await deltaFor(
      fileSystem,
      relativePath,
      baseline.targets[relativePath].digest,
      original,
    );
    const afterFirst = attachExecution({
      session: baseline,
      operations: [
        { id: 'op-1', kind: 'modify_file', relativePath },
      ],
      results: [{ operationId: 'op-1', success: true }],
      deltas: [first],
      attachedAt: '2026-01-31T12:01:00.000Z',
    });

    assert.equal(afterFirst.filesAffected.length, 1);
    assert.equal(afterFirst.operations.length, 1);
    assert.equal(afterFirst.operations[0].recordedAt, '2026-01-31T12:01:00.000Z');
    assert.equal(afterFirst.deltas[relativePath].preDigest.sha256, sha256(original));
    assert.equal(afterFirst.deltas[relativePath].postDigest.sha256, sha256('version 2\n'));

    await fileSystem.writeAtomic(relativePath, 'version 3\n');
    const second = await deltaFor(
      fileSystem,
      relativePath,
      afterFirst.deltas[relativePath].postDigest,
      'version 2\n',
    );
    const afterSecond = attachExecution({
      session: afterFirst,
      operations: [
        { id: 'op-2', kind: 'modify_file', relativePath },
      ],
      results: [{ operationId: 'op-2', success: true }],
      deltas: [second],
      attachedAt: '2026-01-31T12:02:00.000Z',
    });

    const merged = afterSecond.deltas[relativePath];
    assert.equal(merged.preDigest.sha256, sha256(original));
    assert.equal(merged.postDigest.sha256, sha256('version 3\n'));
    assert.equal(merged.changeKind, 'modified');
    assert.equal(afterSecond.filesAffected.length, 1);
    assert.equal(afterSecond.filesAffected[0], relativePath);
    assert.equal(afterSecond.operations.length, 2);
    assert.equal(afterSecond.results.length, 2);
    assert.match(merged.diffContent ?? '', /-version 1\n\+version 2\n/u);
    assert.match(merged.diffContent ?? '', /-version 2\n\+version 3\n/u);
  });

  it('ignores intermediate pre-digests in favor of the session baseline', async () => {
    const { fileSystem } = await createHarness();
    const relativePath = 'src/tampered.ts';
    const original = 'original\n';
    await fileSystem.createFile(relativePath, original);

    const baseline = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: [relativePath],
    });

    await fileSystem.writeAtomic(relativePath, 'rewritten\n');
    const delta = await deltaFor(
      fileSystem,
      relativePath,
      baseline.targets[relativePath].digest,
      original,
    );
    const forged: FileDelta = {
      ...delta,
      preDigest: missingDigest(relativePath),
    };

    const state = attachExecution({
      session: baseline,
      operations: [],
      deltas: [forged],
      attachedAt: '2026-01-31T12:03:00.000Z',
    });

    assert.equal(state.deltas[relativePath].preDigest.exists, true);
    assert.equal(state.deltas[relativePath].preDigest.sha256, sha256(original));
  });

  it('keeps born-in-session files anchored to a nonexistent pre-state', async () => {
    const { fileSystem } = await createHarness();
    const relativePath = 'src/created.ts';

    const baseline = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: [relativePath],
    });

    await fileSystem.createFile(relativePath, 'first\n');
    const created = await deltaFor(
      fileSystem,
      relativePath,
      missingDigest(relativePath),
    );
    const afterCreate = attachExecution({
      session: baseline,
      operations: [{ id: 'op-1', kind: 'create_file', relativePath }],
      deltas: [created],
      attachedAt: '2026-02-01T00:00:00.000Z',
    });

    assert.equal(afterCreate.deltas[relativePath].preDigest.exists, false);
    assert.equal(afterCreate.deltas[relativePath].preDigest.sha256, '');
    assert.equal(afterCreate.deltas[relativePath].changeKind, 'created');

    await fileSystem.writeAtomic(relativePath, 'second\n');
    const modified = await deltaFor(
      fileSystem,
      relativePath,
      afterCreate.deltas[relativePath].postDigest,
      'first\n',
    );
    const afterModify = attachExecution({
      session: afterCreate,
      operations: [{ id: 'op-2', kind: 'modify_file', relativePath }],
      deltas: [modified],
      attachedAt: '2026-02-01T00:01:00.000Z',
    });

    const merged = afterModify.deltas[relativePath];
    assert.equal(merged.preDigest.exists, false);
    assert.equal(merged.preDigest.sha256, '');
    assert.equal(merged.postDigest.sha256, sha256('second\n'));
    assert.equal(merged.changeKind, 'created');
  });

  it('appends multi-file operations and de-duplicates affected paths', async () => {
    const { fileSystem } = await createHarness();
    await fileSystem.createFile('a.txt', 'alpha one\n');
    await fileSystem.createFile('b.txt', 'beta\n');

    const baseline = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['a.txt', 'b.txt', 'c.txt'],
    });

    await fileSystem.writeAtomic('a.txt', 'alpha two\n');
    await fileSystem.deleteFile('b.txt');
    await fileSystem.createFile('c.txt', 'gamma\n');

    const deltas = [
      await deltaFor(fileSystem, 'a.txt', baseline.targets['a.txt'].digest, 'alpha one\n'),
      await deltaFor(fileSystem, 'b.txt', baseline.targets['b.txt'].digest, 'beta\n'),
      await deltaFor(fileSystem, 'c.txt', baseline.targets['c.txt'].digest),
    ];

    const firstBatch = attachExecution({
      session: baseline,
      operations: [
        { id: 'op-1', kind: 'modify_file', relativePath: 'a.txt' },
        { id: 'op-2', kind: 'delete_file', relativePath: 'b.txt' },
        { id: 'op-3', kind: 'create_file', relativePath: 'c.txt' },
      ],
      results: [
        { operationId: 'op-1', success: true },
        { operationId: 'op-2', success: true },
        { operationId: 'op-3', success: true },
      ],
      deltas,
      attachedAt: '2026-02-02T00:00:00.000Z',
    });

    assert.deepEqual([...firstBatch.filesAffected].sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.deepEqual(Object.keys(firstBatch.deltas).sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.equal(firstBatch.deltas['b.txt'].changeKind, 'deleted');
    assert.equal(firstBatch.deltas['b.txt'].postDigest.exists, false);
    assert.equal(firstBatch.operations.length, 3);

    await fileSystem.writeAtomic('c.txt', 'gamma updated\n');
    const nextDelta = await deltaFor(
      fileSystem,
      'c.txt',
      firstBatch.deltas['c.txt'].postDigest,
      'gamma\n',
    );
    const secondBatch = attachExecution({
      session: firstBatch,
      operations: [{ id: 'op-4', kind: 'modify_file', relativePath: 'c.txt' }],
      deltas: [nextDelta],
      attachedAt: '2026-02-02T00:01:00.000Z',
    });

    assert.equal(secondBatch.operations.length, 4);
    assert.deepEqual([...secondBatch.filesAffected].sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.equal(secondBatch.deltas['c.txt'].changeKind, 'created');
    assert.equal(secondBatch.deltas['c.txt'].preDigest.exists, false);
  });

  it('removes deltas that net back to the session baseline', async () => {
    const { fileSystem } = await createHarness();
    const relativePath = 'src/reverted.ts';
    const original = 'stable\n';
    await fileSystem.createFile(relativePath, original);

    const baseline = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: [relativePath],
    });

    await fileSystem.writeAtomic(relativePath, 'changed\n');
    const changed = await deltaFor(
      fileSystem,
      relativePath,
      baseline.targets[relativePath].digest,
      original,
    );
    const afterChange = attachExecution({
      session: baseline,
      operations: [{ id: 'op-1', kind: 'modify_file', relativePath }],
      deltas: [changed],
      attachedAt: '2026-02-03T00:00:00.000Z',
    });

    await fileSystem.writeAtomic(relativePath, original);
    const reverted = await deltaFor(
      fileSystem,
      relativePath,
      afterChange.deltas[relativePath].postDigest,
      'changed\n',
    );
    const afterRevert = attachExecution({
      session: afterChange,
      operations: [{ id: 'op-2', kind: 'modify_file', relativePath }],
      deltas: [reverted],
      attachedAt: '2026-02-03T00:01:00.000Z',
    });

    assert.deepEqual(afterRevert.filesAffected, []);
    assert.deepEqual(afterRevert.deltas, {});
    assert.equal(afterRevert.operations.length, 2);
  });

  it('starts from a bare baseline snapshot and rejects inactive sessions', async () => {
    const { fileSystem } = await createHarness();

    const baseline = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['src/missing.ts'],
    });

    const state = createSessionExecutionState(baseline);
    assert.equal(state.sessionId, SESSION_ID);
    assert.equal(state.status, 'active');
    assert.deepEqual(state.deltas, {});

    assert.throws(
      () => attachExecution({
        session: { ...state, status: 'committed' },
        operations: [],
        deltas: [],
      }),
      (error: unknown) => error instanceof InactiveSessionError,
    );
  });
});
