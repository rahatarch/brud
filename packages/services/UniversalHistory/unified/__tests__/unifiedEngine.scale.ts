/**
 * Unified reversal engine — scale gate (D-15 plan §7, Build plan §5 / G-U4):
 * undo over 1,000 steps with constant-cost cursor updates.
 * Run: npm run test:history-scale --workspace @brud/kernel
 */
import { statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import { UnifiedHistoryService } from '../service/index.js';
import { UnifiedHistoryStore } from '../store/index.js';

const STEPS = 1_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

describe('unified reversal engine — scale (1,000 undo steps)', { concurrency: false }, () => {
  it('undoes 1,000 steps with flat per-step cost and constant-size cursor updates', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-unified-undo-scale-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    const driver = new DurableNodeStorageDriver();
    const journal = createFileMutationJournal();
    const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
    await fs.initialize();
    const service = new UnifiedHistoryService({
      store: new UnifiedHistoryStore({ dbPath, historyRoot, driver }),
      fileSystem: () => fs,
      journal,
    });
    await service.start();
    context.after(() => service.dispose());
    const engine = new ReversalEngine({ service, fileSystem: () => fs });

    for (let i = 0; i < STEPS; i += 1) {
      await fs.writeAtomic(`files/f-${i % 50}.txt`, `version ${i}\n`);
    }
    await service.flush();
    const entriesBefore = service.store.maxSeq();

    const checkpoint = new DatabaseSync(dbPath);
    checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    checkpoint.close();
    const mainBefore = statSync(dbPath).size;

    const durations: number[] = [];
    const started = process.hrtime.bigint();
    for (let i = 0; i < STEPS; i += 1) {
      const t0 = process.hrtime.bigint();
      const report = await engine.undo();
      durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
      assert.equal(report.status, 'success', `step ${i}: ${JSON.stringify(report)}`);
    }
    const totalMs = Number(process.hrtime.bigint() - started) / 1e6;

    const first = median(durations.slice(0, 100));
    const last = median(durations.slice(-100));
    assert.equal(service.store.maxSeq(), entriesBefore, 'undo must not add entries');
    assert.ok(service.store.getCursor() <= entriesBefore - STEPS, 'cursor moved back 1,000 file steps');
    for (let i = 0; i < 50; i += 1) {
      assert.equal(await fs.exists(`files/f-${i}.txt`), false);
    }
    assert.ok(last / first < 3, `per-step cost grew: first ${first.toFixed(2)} ms, last ${last.toFixed(2)} ms`);

    const inspect = new DatabaseSync(dbPath, { readOnly: true });
    const stateRows = (inspect.prepare('SELECT COUNT(*) AS n FROM history_state').get() as { n: number }).n;
    inspect.close();
    assert.equal(stateRows, 1);
    const mainAfter = statSync(dbPath).size;
    assert.ok(Math.abs(mainAfter - mainBefore) <= 4096 * 2, `main database changed by ${mainAfter - mainBefore} bytes`);

    console.log([
      `[undo-scale] ${STEPS} undo steps: ${(totalMs / 1000).toFixed(2)} s (${(totalMs / STEPS).toFixed(2)} ms/step)`,
      `[undo-scale] median step: first 100 ${first.toFixed(2)} ms, last 100 ${last.toFixed(2)} ms, ratio ${(last / first).toFixed(2)} (limit 3)`,
      `[undo-scale] entries unchanged: ${entriesBefore}; history_state rows: ${stateRows}; main db change ${mainAfter - mainBefore} bytes`,
    ].join('\n'));
  });
});
