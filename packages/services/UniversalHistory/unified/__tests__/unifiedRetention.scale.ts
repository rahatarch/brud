/**
 * Retention and garbage collection — scale gate (D-15 U-8, G-U8).
 * Run: npm run test:history-scale --workspace @brud/kernel   (uses --expose-gc)
 * Not matched by the default kernel test glob.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { UnifiedHistoryStore } from '../store/index.js';

const ENTRIES = 100_000;
const OLD = 60_000;
const ORPHAN_CONTENTS = 20_000;
const DAY = 86_400_000;
const RUN_LIMIT_MS = 20_000;
const GC_LIMIT_MS = 20_000;
const HEAP_LIMIT_MIB = 64;
const gc = (globalThis as { gc?: () => void }).gc;

function heapMiB(): number {
  gc?.();
  gc?.();
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function elapsed(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

describe('unified history retention — scale (100,000 entries)', { concurrency: false }, () => {
  it('removes old history in bounded runs with flat memory', async (context) => {
    assert.ok(gc, 'run with --expose-gc');
    const root = await mkdtemp(join(tmpdir(), 'brud-retention-scale-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const clock = { now: Date.now() };
    const store = new UnifiedHistoryStore({
      dbPath: join(historyRoot, 'universal.db'),
      historyRoot,
      driver: new DurableNodeStorageDriver(),
      now: () => clock.now,
    });
    await store.open();
    context.after(() => store.close());
    store.registerEntryType({ namespace: 'brud.core', type: 'file', schemaVersion: 1, payloadSchema: { type: 'object' }, reversalMode: 'none', registeredBy: 'kernel', registeredAt: 0 });
    const session = store.createSession({ prompt: 'scale', implicit: true, now: clock.now }).sessionId;

    // 60,000 entries 200 days old, then 40,000 recent ones, in batches of 1,000.
    const old = clock.now - 200 * DAY;
    for (let start = 0; start < ENTRIES; start += 1_000) {
      const batch = [];
      for (let i = start; i < start + 1_000; i += 1) {
        batch.push(await store.prepareEntry({
          namespace: 'brud.core',
          type: 'file',
          schemaVersion: 1,
          payload: { path: `src/file-${i % 500}.ts`, operation: 'write', preSha256: null, postSha256: (i % 16).toString(16).repeat(64), preCaptured: false, nodeKind: 'file', size: 10 },
          createdAt: i < OLD ? old : clock.now,
        }));
      }
      store.appendEntries(session, batch, { truncateRedoTail: true, advanceCursor: true });
    }
    for (let i = 0; i < ORPHAN_CONTENTS; i += 1) {
      await store.putContent(new TextEncoder().encode(`orphan-${i}`));
    }
    clock.now += 2 * 60 * 60 * 1000;
    const cutoffMs = clock.now - 90 * DAY;

    const heapBefore = heapMiB();
    const runs: { ms: number; removed: number }[] = [];
    for (;;) {
      const started = process.hrtime.bigint();
      const report = store.applyRetention({ cutoffMs, minUndoEntries: 10_000, keepSessionId: session });
      runs.push({ ms: elapsed(started), removed: report.fileEntriesRemoved });
      if (!report.truncated) {
        break;
      }
      assert.ok(runs.length < 10, 'retention must converge');
    }
    const gcStarted = process.hrtime.bigint();
    const garbage = store.collectGarbage({ now: clock.now, graceMs: 60 * 60 * 1000 });
    const gcMs = elapsed(gcStarted);
    const heapGrowth = heapMiB() - heapBefore;

    const remaining = store.listEntries({ namespace: 'brud.core', type: 'file', order: 'asc', limit: 1 }).rows[0]?.seq;
    console.log([
      `[retention-scale] runs: ${runs.map((r) => `${r.removed} in ${r.ms.toFixed(0)} ms`).join(', ')} (limit ${RUN_LIMIT_MS} ms each)`,
      `[retention-scale] gc: ${garbage.contentsRemoved} rows in ${gcMs.toFixed(0)} ms (limit ${GC_LIMIT_MS})`,
      `[retention-scale] heap growth after GC: ${heapGrowth.toFixed(2)} MiB (limit ${HEAP_LIMIT_MIB})`,
    ].join('\n'));

    assert.equal(runs.reduce((sum, run) => sum + run.removed, 0), OLD);
    assert.equal(remaining, OLD + 1);
    assert.ok(runs.every((run) => run.ms < RUN_LIMIT_MS), JSON.stringify(runs));
    assert.ok(runs.every((run) => run.removed <= 50_000 + 2_000));
    assert.equal(garbage.contentsRemoved, ORPHAN_CONTENTS);
    assert.ok(gcMs < GC_LIMIT_MS, `gc took ${gcMs} ms`);
    assert.ok(heapGrowth < HEAP_LIMIT_MIB, `heap grew ${heapGrowth.toFixed(1)} MiB`);
  });
});
