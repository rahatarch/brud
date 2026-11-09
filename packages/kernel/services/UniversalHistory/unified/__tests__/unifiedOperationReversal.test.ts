import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import {
  CORE_NAMESPACE,
  UnifiedHistoryService,
  UnifiedHistoryStore,
} from '../index.js';
import type { EntryRow } from '../store/types.js';

interface Harness {
  readonly service: UnifiedHistoryService;
  readonly engine: ReversalEngine;
  readonly store: UnifiedHistoryStore;
  readonly fs: BrudFileSystem;
  readonly applied: unknown[];
}

async function harness(context: TestContext): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-unified-operations-')));
  const driver = new DurableNodeStorageDriver();
  const journal = createFileMutationJournal();
  const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
  await fs.initialize();
  const store = new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: join(root, '.brud/history'), driver });
  const service = new UnifiedHistoryService({ store, fileSystem: () => fs, journal });
  await service.start();
  context.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const engine = new ReversalEngine({ service, fileSystem: () => fs, callbackTimeoutMs: 2_000 });
  const applied: unknown[] = [];
  service.registerEntryType('acme.x', {
    type: 'op',
    schemaVersion: 1,
    payloadSchema: { type: 'object' },
    reversal: {
      mode: 'inverse-payload',
      apply: async (inverse) => {
        applied.push(inverse);
      },
    },
  }, 'test');
  return { service, engine, store, fs, applied };
}

interface MixedSession {
  readonly sessionId: string;
  readonly targetA: EntryRow;
  readonly targetB: EntryRow;
  readonly op1: EntryRow;
  readonly op2: EntryRow;
  readonly rawFile: EntryRow;
}

async function mixedSession(h: Harness): Promise<MixedSession> {
  await h.fs.writeAtomic('a.txt', 'a-before');
  await h.fs.writeAtomic('b.txt', 'b-before');
  const sessionId = await h.service.beginSession('mixed', { declaredTargets: ['a.txt', 'b.txt'] });
  await h.fs.writeAtomic('a.txt', 'a-after');
  await h.fs.writeAtomic('b.txt', 'b-after');
  await h.service.recordEntry('acme.x', sessionId, {
    type: 'op',
    schemaVersion: 1,
    payload: { n: 1 },
    inversePayload: { undo: 1 },
  });
  await h.service.recordEntry('acme.x', sessionId, {
    type: 'op',
    schemaVersion: 1,
    payload: { n: 2 },
    inversePayload: { undo: 2 },
  });
  await h.service.commitSession(sessionId, 'completed');
  await h.service.flush();

  const targets = h.service.listEntries({
    sessionId,
    namespace: CORE_NAMESPACE,
    type: 'session-target',
    order: 'asc',
    limit: 100,
  }).rows;
  const targetA = targets.find((entry) => (JSON.parse(entry.payloadJson ?? '{}') as { path?: string }).path === 'a.txt');
  const targetB = targets.find((entry) => (JSON.parse(entry.payloadJson ?? '{}') as { path?: string }).path === 'b.txt');
  const ops = h.service.listEntries({ sessionId, namespace: 'acme.x', type: 'op', order: 'asc', limit: 100 }).rows;
  const rawFile = h.service.listEntries({
    sessionId,
    namespace: CORE_NAMESPACE,
    type: 'file',
    order: 'desc',
    limit: 1,
  }).rows[0];

  assert.ok(targetA !== undefined);
  assert.ok(targetB !== undefined);
  assert.ok(ops[0] !== undefined);
  assert.ok(ops[1] !== undefined);
  assert.ok(rawFile !== undefined);

  return {
    sessionId,
    targetA,
    targetB,
    op1: ops[0] as EntryRow,
    op2: ops[1] as EntryRow,
    rawFile,
  };
}

describe('ReversalEngine — per-operation revert', () => {
  it('reverses only the selected file target and producer entry', async (context) => {
    const h = await harness(context);
    const session = await mixedSession(h);

    const receipt = await h.engine.revertOperations(session.sessionId, [
      session.targetA.entryId,
      session.op1.entryId,
    ]);

    assert.equal(receipt.status, 'success');
    assert.equal(receipt.entriesReverted, 2);
    assert.deepEqual(receipt.skipped, []);
    assert.equal(await h.fs.readText('a.txt'), 'a-before');
    assert.equal(await h.fs.readText('b.txt'), 'b-after');
    assert.deepEqual(h.applied, [{ undo: 1 }]);
    assert.equal(h.service.getSessionView(session.sessionId)?.session.status, 'committed');

    const audit = h.store.listReversals(session.sessionId);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.kind, 'session');
    assert.equal(audit[0]?.status, 'success');
    assert.deepEqual(
      [...(audit[0]?.revertedEntries ?? [])].sort((a, b) => a - b),
      [session.targetA.seq, session.op1.seq].sort((a, b) => a - b),
    );
  });

  it('continues with reversible operations and reports conflicts and unknown ids', async (context) => {
    const h = await harness(context);
    const session = await mixedSession(h);

    // Simulate an external edit after the session committed.
    await h.fs.writeAtomic('b.txt', 'b-drifted');

    const receipt = await h.engine.revertOperations(session.sessionId, [
      session.op1.entryId,
      session.op2.entryId,
      session.targetB.entryId,
      session.rawFile.entryId,
      'missing-entry-id',
    ]);

    assert.equal(receipt.status, 'partial');
    assert.equal(receipt.entriesReverted, 2);
    assert.deepEqual(h.applied, [{ undo: 1 }, { undo: 2 }]);
    assert.equal(await h.fs.readText('b.txt'), 'b-drifted');

    const codes = receipt.skipped.map((skip) => [skip.entryId, skip.code]);
    assert.deepEqual(codes, [
      [session.rawFile.entryId, 'ENTRY_NOT_REVERSIBLE'],
      ['missing-entry-id', 'ENTRY_NOT_FOUND'],
      [session.targetB.entryId, 'STALE_BASELINE_CONFLICT'],
    ]);

    const audit = h.store.listReversals(session.sessionId);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.status, 'partial');
    assert.deepEqual(
      [...(audit[0]?.revertedEntries ?? [])].sort((a, b) => a - b),
      [session.op1.seq, session.op2.seq].sort((a, b) => a - b),
    );
    assert.match(audit[0]?.errorMessage ?? '', /STALE_BASELINE_CONFLICT/u);
  });
});