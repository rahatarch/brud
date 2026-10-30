/**
 * Unified history store — scale gate (D-15 plan §7, Build plan §3 / G-U2).
 * Run: npm run test:history-scale --workspace @brud/kernel   (uses --expose-gc)
 * Not matched by the default kernel test glob.
 */
import { statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { UnifiedHistoryStore } from '../store/index.js';

const ENTRIES = 100_000;
const PAGE = 100;
const gc = (globalThis as { gc?: () => void }).gc;

function heapMiB(): number {
  gc?.();
  gc?.();
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function timeReads(read: () => void, runs = 50): number {
  for (let i = 0; i < 5; i += 1) {read();}
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.hrtime.bigint();
    read();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return median(samples);
}

describe('unified history store — scale (100,000 entries)', { concurrency: false }, () => {
  it('meets the measurable scaling properties', async (context) => {
    assert.ok(gc, 'run with --expose-gc');
    const root = await mkdtemp(join(tmpdir(), 'brud-unified-scale-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver: new DurableNodeStorageDriver() });
    await store.open();
    context.after(() => store.close());
    store.registerEntryType({ namespace: 'brud.core', type: 'file', schemaVersion: 1, payloadSchema: { type: 'object' }, reversalMode: 'none', registeredBy: 'kernel', registeredAt: 0 });
    const session = store.createSession({ prompt: 'scale', implicit: true, now: Date.now() }).sessionId;

    // 1. Ingest 100,000 file entries, one transaction each (realistic recording).
    const heapBefore = heapMiB();
    const started = process.hrtime.bigint();
    for (let i = 0; i < ENTRIES; i += 1) {
      const prepared = await store.prepareEntry({
        namespace: 'brud.core',
        type: 'file',
        schemaVersion: 1,
        payload: { path: `src/dir-${i % 500}/file-${i}.ts`, operation: 'write', preSha256: null, postSha256: 'a'.repeat(64), preCaptured: false, nodeKind: 'file', size: 10 },
        createdAt: Date.now(),
      });
      store.appendEntries(session, [prepared], { truncateRedoTail: true, advanceCursor: true });
    }
    const ingestMs = Number(process.hrtime.bigint() - started) / 1e6;
    const heapGrowth = heapMiB() - heapBefore;
    const seqs = store.listEntries({ order: 'asc', limit: 3 }).rows.map((r) => r.seq);

    assert.equal(store.maxSeq(), ENTRIES);
    assert.deepEqual(seqs, [1, 2, 3]);
    assert.equal(store.getCursor(), ENTRIES);
    assert.ok(heapGrowth < 64, `heap grew ${heapGrowth.toFixed(1)} MiB`);

    // 2. Flat paging: page 1 vs page 1,000 (limit 100, keyset).
    const page1000Before = ENTRIES - PAGE * 999 + 1;
    const p1 = timeReads(() => store.listEntries({ order: 'desc', limit: PAGE }));
    const p1000 = timeReads(() => store.listEntries({ order: 'desc', limit: PAGE, beforeSeq: page1000Before }));
    const page1000 = store.listEntries({ order: 'desc', limit: PAGE, beforeSeq: page1000Before }).rows;
    assert.equal(page1000.length, PAGE);
    assert.equal(page1000[0]?.seq, page1000Before - 1);
    assert.ok(p1000 / p1 < 3, `page 1000 ${p1000.toFixed(3)} ms vs page 1 ${p1.toFixed(3)} ms`);

    const plans = {
      page1000: store.explainListEntries({ order: 'desc', limit: PAGE, beforeSeq: page1000Before }),
      path: store.explainListEntries({ path: 'src/dir-7/file-7.ts' }),
      session: store.explainListEntries({ sessionId: session, beforeSeq: 500 }),
    };
    assert.ok(plans.page1000.some((d) => /SEARCH entries USING INTEGER PRIMARY KEY/u.test(d)), JSON.stringify(plans.page1000));
    assert.ok(plans.path.some((d) => /USING INDEX idx_entries_path/u.test(d)), JSON.stringify(plans.path));
    assert.ok(plans.session.some((d) => /USING INDEX idx_entries_session/u.test(d)), JSON.stringify(plans.session));
    for (const details of Object.values(plans)) {
      assert.ok(!details.some((d) => /^SCAN entries/u.test(d)), JSON.stringify(details));
    }
    const pathHits = store.listEntries({ path: 'src/dir-7/file-7.ts' }).rows;
    assert.deepEqual(pathHits.map((r) => r.seq), [8]);

    // 3. A 10 MiB payload is offloaded and round-trips.
    const dbBefore = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`);
    const big = { path: 'assets/huge.json', data: 'q'.repeat(10 * 1024 * 1024) };
    const prepared = await store.prepareEntry({ namespace: 'brud.core', type: 'file', schemaVersion: 1, payload: big, createdAt: Date.now() });
    const [bigRow] = store.appendEntries(session, [prepared], { advanceCursor: true });
    const dbGrowth = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) - dbBefore;
    assert.ok(bigRow);
    assert.equal(bigRow.payloadJson, null);
    assert.ok(dbGrowth < 1024 * 1024, `database grew ${dbGrowth} bytes`);
    assert.deepEqual(await store.resolvePayload(bigRow), big);

    // 4. Cursor updates are constant-cost. Merge earlier WAL frames first so the
    // measurement isolates the cursor writes (a checkpoint during the loop would
    // otherwise move previous writes into the main file).
    const checkpoint = new DatabaseSync(dbPath);
    checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    checkpoint.close();
    const mainBefore = sizeOf(dbPath);
    const cursorStart = process.hrtime.bigint();
    for (let i = 0; i < 1_000; i += 1) {
      store.setCursor(ENTRIES - i);
    }
    const cursorMs = Number(process.hrtime.bigint() - cursorStart) / 1e6;
    assert.equal(store.getCursor(), ENTRIES - 999);
    const inspect = new DatabaseSync(dbPath, { readOnly: true });
    const stateRows = (inspect.prepare('SELECT COUNT(*) AS n FROM history_state').get() as { n: number }).n;
    inspect.close();
    assert.equal(stateRows, 1, 'cursor updates must not add rows');
    assert.ok(Math.abs(sizeOf(dbPath) - mainBefore) <= 4096 * 2, `main database changed by ${sizeOf(dbPath) - mainBefore} bytes`);

    console.log([
      `[scale] node ${process.version}`,
      `[scale] ingest ${ENTRIES} entries: ${(ingestMs / 1000).toFixed(2)} s (${(ingestMs * 1000 / ENTRIES).toFixed(1)} µs/entry)`,
      `[scale] heap growth after GC: ${heapGrowth.toFixed(2)} MiB (limit 64)`,
      `[scale] page 1: ${p1.toFixed(3)} ms; page 1000: ${p1000.toFixed(3)} ms; ratio ${(p1000 / p1).toFixed(2)} (limit 3)`,
      `[scale] plan page1000: ${plans.page1000.join(' | ')}`,
      `[scale] plan path: ${plans.path.join(' | ')}`,
      `[scale] plan session: ${plans.session.join(' | ')}`,
      `[scale] 10 MiB payload: db+wal growth ${dbGrowth} bytes (limit 1048576)`,
      `[scale] 1000 cursor updates: ${cursorMs.toFixed(1)} ms; main db size change ${sizeOf(dbPath) - mainBefore} bytes`,
    ].join('\n'));
  });
});
