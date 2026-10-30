import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { ForeignReversalPlanError, LegacySessionAdapter } from '../compat/LegacySessionAdapter.js';
import { UnifiedReversalConflictError } from '../engine/errors.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import { CORE_NAMESPACE, UnifiedHistoryService } from '../service/index.js';
import type { EntryReversal } from '../service/index.js';
import { UnifiedHistoryStore } from '../store/index.js';

const ROOT = '/workspace';

interface Harness {
  readonly service: UnifiedHistoryService;
  readonly engine: ReversalEngine;
  readonly fs: BrudFileSystem;
  readonly store: UnifiedHistoryStore;
}

async function harness(context: TestContext, callbackTimeoutMs = 2_000): Promise<Harness> {
  const driver = new InMemoryStorageDriver();
  const journal = createFileMutationJournal();
  const fs = new BrudFileSystem(ROOT, driver, { mutationJournal: journal });
  await fs.initialize();
  const store = new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: `${ROOT}/.brud/history`, driver });
  const service = new UnifiedHistoryService({ store, fileSystem: () => fs, journal });
  await service.start();
  context.after(() => service.dispose());
  const engine = new ReversalEngine({ service, fileSystem: () => fs, callbackTimeoutMs });
  return { service, engine, fs, store };
}

/**
 * Registers `acme.x` with the given reversal and returns a human session that
 * changed `doc.txt` and holds one acme entry. Pass `null` for no inverse payload.
 */
async function mixedSession(h: Harness, reversal: EntryReversal, inverse: unknown = { undo: true }): Promise<string> {
  h.service.registerEntryType('acme.x', { type: 'op', schemaVersion: 1, payloadSchema: { type: 'object' }, reversal }, 'test');
  await h.fs.writeAtomic('doc.txt', 'before');
  const id = await h.service.beginSession('mixed', { declaredTargets: ['doc.txt'] });
  await h.fs.writeAtomic('doc.txt', 'after');
  await h.service.recordEntry('acme.x', id, { type: 'op', schemaVersion: 1, payload: { do: true }, ...(inverse === null ? {} : { inversePayload: inverse }) });
  await h.service.commitSession(id, 'completed');
  return id;
}

describe('ReversalEngine — redo tail never discards other history', () => {
  it('keeps committed session targets and producer entries when a new edit follows an undo', async (context) => {
    const h = await harness(context);
    await h.fs.writeAtomic('a.txt', 'v1');
    const id = await h.service.beginSession('s', { declaredTargets: ['b.txt'] });
    await h.fs.writeAtomic('b.txt', 'b1');
    await h.service.commitSession(id, 'completed');
    await h.fs.writeAtomic('a.txt', 'v2');
    await h.service.flush();

    assert.equal((await h.engine.undo()).status, 'success');
    assert.equal(await h.fs.readText('a.txt'), 'v1');
    await h.fs.writeAtomic('a.txt', 'v3');
    await h.service.flush();

    const targets = h.store.listEntries({ sessionId: id, namespace: CORE_NAMESPACE, type: 'session-target' }).rows;
    assert.equal(targets.length, 1);
    const plan = await h.engine.planSessionReversal(id);
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.fileActions.map((a) => [a.path, a.action]), [['b.txt', 'delete']]);
  });

  it('undo reverses file mutations only, never session targets', async (context) => {
    const h = await harness(context);
    const id = await h.service.beginSession('s', { declaredTargets: ['x.txt'] });
    await h.fs.writeAtomic('x.txt', '1');
    await h.service.commitSession(id, 'completed');
    const report = await h.engine.undo();
    assert.deepEqual(report.restoredPaths, ['x.txt']);
    assert.equal(await h.fs.exists('x.txt'), false);
    assert.equal(h.store.getSession(id)?.status, 'committed');
  });
});

describe('ReversalEngine — inverse-payload mode', () => {
  it('restores files first, then applies the inverse payload, and marks the session reverted', async (context) => {
    const h = await harness(context);
    const calls: string[] = [];
    const id = await mixedSession(h, {
      mode: 'inverse-payload',
      apply: async (input) => {
        calls.push(`apply:${JSON.stringify(input)}:file=${await h.fs.readText('doc.txt')}`);
      },
    });
    const plan = await h.engine.planSessionReversal(id);
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.entryActions.map((a) => a.mode), ['inverse-payload']);
    const receipt = await h.engine.executeSessionReversal(plan);
    assert.equal(receipt.status, 'success');
    assert.equal(receipt.entriesReverted, 1);
    assert.deepEqual(calls, ['apply:{"undo":true}:file=before']);
    assert.equal(h.store.getSession(id)?.status, 'reverted');
  });

  it('reports INVERSE_PAYLOAD_INVALID when an entry has no inverse', async (context) => {
    const h = await harness(context);
    const id = await mixedSession(h, { mode: 'inverse-payload', apply: async () => undefined }, null);
    const plan = await h.engine.planSessionReversal(id);
    assert.equal(plan.isExecutable, false);
    assert.deepEqual(plan.conflicts.map((c) => c.code), ['INVERSE_PAYLOAD_INVALID']);
  });
});

describe('ReversalEngine — handler mode and guards', () => {
  it('runs handlers last, after files and inverse payloads', async (context) => {
    const h = await harness(context);
    const order: string[] = [];
    const id = await mixedSession(h, {
      mode: 'handler',
      detectConflict: async () => null,
      revert: async () => {
        order.push(`handler:file=${await h.fs.readText('doc.txt')}`);
      },
    });
    // Files are restored before any handler runs.
    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.entryActions.map((a) => a.mode), ['handler']);
    await h.engine.executeSessionReversal(plan);
    assert.deepEqual(order, ['handler:file=before']);

    // Inverse payloads run before handlers.
    const h2 = await harness(context);
    const seen: string[] = [];
    h2.service.registerEntryType('acme.inv', { type: 'op', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'inverse-payload', apply: async () => { seen.push('inverse'); } } }, 'test');
    h2.service.registerEntryType('acme.h', { type: 'op', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'handler', detectConflict: async () => null, revert: async () => { seen.push('handler'); } } }, 'test');
    const s2 = await h2.service.beginSession('order');
    await h2.service.recordEntry('acme.h', s2, { type: 'op', schemaVersion: 1, payload: {} });
    await h2.service.recordEntry('acme.inv', s2, { type: 'op', schemaVersion: 1, payload: {}, inversePayload: {} });
    await h2.service.commitSession(s2, 'completed');
    await h2.engine.executeSessionReversal(await h2.engine.planSessionReversal(s2));
    assert.deepEqual(seen, ['inverse', 'handler']);
  });

  it('surfaces handler-detected conflicts and refuses post-state handler plans', async (context) => {
    const h = await harness(context);
    const id = await mixedSession(h, {
      mode: 'handler',
      detectConflict: async () => ({ code: 'X', message: 'remote record moved' }),
      revert: async () => undefined,
    });
    const pre = await h.engine.planSessionReversal(id);
    assert.deepEqual(pre.conflicts.map((c) => [c.code, c.message]), [['HANDLER_CONFLICT', 'remote record moved']]);
    await assert.rejects(() => h.engine.executeSessionReversal(pre), UnifiedReversalConflictError);
    const post = await h.engine.planSessionReversal(id, 'post');
    assert.ok(post.conflicts.some((c) => c.code === 'REVERTER_UNAVAILABLE'));
  });

  it('blocks the plan when the owner is not active (REVERTER_UNAVAILABLE)', async (context) => {
    const h = await harness(context);
    h.service.registerEntryType('acme.x', { type: 'op', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'handler', detectConflict: async () => null, revert: async () => undefined } }, 'test').dispose();
    const id = await h.service.beginSession('gone');
    await h.service.recordEntry('acme.x', id, { type: 'op', schemaVersion: 1, payload: {} });
    await h.service.commitSession(id, 'completed');
    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.conflicts.map((c) => c.code), ['REVERTER_UNAVAILABLE']);
    assert.equal(plan.isExecutable, false);
  });

  it('writes nothing when the owner disappears between planning and execution', async (context) => {
    const h = await harness(context);
    h.service.registerEntryType('acme.x', { type: 'op', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'none' } }, 'test');
    const registration = h.service.registerEntryType('acme.y', { type: 'op', schemaVersion: 1, payloadSchema: true, reversal: { mode: 'handler', detectConflict: async () => null, revert: async () => undefined } }, 'test');
    await h.fs.writeAtomic('doc.txt', 'before');
    const id = await h.service.beginSession('race', { declaredTargets: ['doc.txt'] });
    await h.fs.writeAtomic('doc.txt', 'after');
    await h.service.recordEntry('acme.y', id, { type: 'op', schemaVersion: 1, payload: {} });
    await h.service.commitSession(id, 'completed');
    const plan = await h.engine.planSessionReversal(id);
    assert.equal(plan.isExecutable, true);
    registration.dispose();
    await assert.rejects(() => h.engine.executeSessionReversal(plan), (error: unknown) => error instanceof UnifiedReversalConflictError && error.conflicts[0]?.code === 'REVERTER_UNAVAILABLE');
    assert.equal(await h.fs.readText('doc.txt'), 'after');
    assert.equal(h.store.getSession(id)?.status, 'committed');
  });

  it('times out a hanging handler: partial result, files reported, session stays committed', async (context) => {
    const h = await harness(context, 50);
    const id = await mixedSession(h, {
      mode: 'handler',
      detectConflict: async () => null,
      revert: () => new Promise<void>(() => undefined),
    });
    const receipt = await h.engine.executeSessionReversal(await h.engine.planSessionReversal(id));
    assert.equal(receipt.status, 'partial');
    assert.equal(receipt.filesRestored, 1);
    assert.equal(receipt.entriesReverted, 0);
    assert.match(receipt.failure?.message ?? '', /timed out after 50 ms/u);
    assert.equal(await h.fs.readText('doc.txt'), 'before');
    assert.equal(h.store.getSession(id)?.status, 'committed');
    assert.equal(h.store.listReversals(id)[0]?.status, 'partial');
  });

  it('stops at the first failing handler', async (context) => {
    const h = await harness(context);
    const ran: string[] = [];
    h.service.registerEntryType('acme.h', {
      type: 'op',
      schemaVersion: 1,
      payloadSchema: { type: 'object' },
      reversal: {
        mode: 'handler',
        detectConflict: async () => null,
        revert: async (entry) => {
          ran.push(String((entry.payload as { n: number }).n));
          if ((entry.payload as { n: number }).n === 1) {
            throw new Error('boom');
          }
        },
      },
    }, 'test');
    const id = await h.service.beginSession('two');
    await h.service.recordEntry('acme.h', id, { type: 'op', schemaVersion: 1, payload: { n: 1 } });
    await h.service.recordEntry('acme.h', id, { type: 'op', schemaVersion: 1, payload: { n: 2 } });
    await h.service.commitSession(id, 'completed');
    const receipt = await h.engine.executeSessionReversal(await h.engine.planSessionReversal(id));
    assert.equal(receipt.status, 'partial');
    assert.deepEqual(ran, ['1']);
    assert.equal(receipt.failure?.message, 'boom');
  });

  it('ignores producer entries registered with mode none', async (context) => {
    const h = await harness(context);
    const id = await mixedSession(h, { mode: 'none' });
    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.entryActions, []);
    assert.equal(plan.isExecutable, true);
  });
});

describe('LegacySessionAdapter', () => {
  it('refuses to execute a plan it did not produce', async (context) => {
    const h = await harness(context);
    const adapter = new LegacySessionAdapter(h.service, h.engine);
    await assert.rejects(
      () => adapter.executeReversal({ sessionId: 'BR-20261030-001', targetState: 'pre', actions: [], conflicts: [], isExecutable: true }),
      ForeignReversalPlanError,
    );
  });
});
