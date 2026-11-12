import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IUniversalHistory } from '../contracts/IUniversalHistory.js';
import type { Checkpoint, HistoryEntry, RollbackReport } from '../contracts/models.js';
import { HistoryAccessDeniedError, ReadOnlyHistoryFacade } from './ReadOnlyHistoryFacade.js';

function recordingJournal(): { journal: IUniversalHistory; calls: string[] } {
  const calls: string[] = [];
  const report = {} as RollbackReport;
  const journal: IUniversalHistory = {
    beginSession: async () => { calls.push('beginSession'); },
    recordCheckpoint: async () => { calls.push('recordCheckpoint'); return 'CP-1'; },
    rollbackToCheckpoint: async () => { calls.push('rollbackToCheckpoint'); return report; },
    undo: async () => { calls.push('undo'); return report; },
    redo: async () => { calls.push('redo'); return report; },
    getHistory: async () => { calls.push('getHistory'); return [] as HistoryEntry[]; },
    getCheckpoints: async () => { calls.push('getCheckpoints'); return [] as Checkpoint[]; },
  };
  return { journal, calls };
}

describe('ReadOnlyHistoryFacade', () => {
  it('delegates reads and rejects every mutation without reaching the journal', async () => {
    const { journal, calls } = recordingJournal();
    const facade = new ReadOnlyHistoryFacade(journal);

    assert.deepEqual(await facade.getHistory(), []);
    assert.deepEqual(await facade.getCheckpoints(), []);
    for (const attempt of [
      () => facade.beginSession('s'),
      () => facade.recordCheckpoint('c'),
      () => facade.rollbackToCheckpoint('CP-1'),
      () => facade.undo(),
      () => facade.redo(),
    ]) {
      await assert.rejects(attempt, HistoryAccessDeniedError);
    }
    assert.deepEqual(calls, ['getHistory', 'getCheckpoints']);
  });

  it('keeps the delegate unreachable and the instance frozen', () => {
    const { journal } = recordingJournal();
    const facade = new ReadOnlyHistoryFacade(journal);

    assert.ok(Object.isFrozen(facade));
    assert.deepEqual(Object.keys(facade), []);
    assert.deepEqual(Object.getOwnPropertyNames(facade), []);
    assert.equal((facade as unknown as { inner?: unknown }).inner, undefined);
    assert.throws(() => {
      (facade as unknown as { inner: unknown }).inner = journal;
    }, TypeError);
  });
});
