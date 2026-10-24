import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import {
  DEFAULT_SEQUENCE_FILE,
  IdAllocator,
  IdSequenceOverflowError,
  MAX_SEQUENCE,
  formatSessionId,
  formatUtcDate,
} from './IdAllocator.js';

const HISTORY_ROOT = '/workspace/.brud/history';

interface Harness {
  readonly allocator: IdAllocator;
  readonly driver: InMemoryStorageDriver;
  readonly fileSystem: BrudFileSystem;
}

async function createHarness(
  options: { now?: () => Date; sequenceFile?: string } = {},
  driver: InMemoryStorageDriver = new InMemoryStorageDriver(),
): Promise<Harness> {
  const fileSystem = new BrudFileSystem(HISTORY_ROOT, driver);
  await fileSystem.initialize();
  const allocator = new IdAllocator(fileSystem, options);
  return { allocator, driver, fileSystem };
}

describe('IdAllocator', () => {
  describe('UTC formatting', () => {
    it('formats dates using UTC components', () => {
      assert.equal(formatUtcDate(new Date(Date.UTC(2026, 0, 31, 23, 59, 59))), '20260131');
      assert.equal(formatUtcDate(new Date(Date.UTC(2026, 11, 1, 0, 0, 0))), '20261201');
    });

    it('formats a local-time offset at a day boundary in UTC', () => {
      const date = new Date('2026-03-01T00:30:00+10:00');

      assert.equal(date.getUTCDate(), 28);
      assert.equal(formatUtcDate(date), '20260228');
    });

    it('pads short date segments', () => {
      assert.equal(formatUtcDate(new Date('0007-01-02T00:00:00.000Z')), '00070102');
    });

    it('rejects invalid dates', () => {
      assert.throws(() => formatUtcDate(new Date(Number.NaN)), RangeError);
    });

    it('formats sequence numbers with a minimum width of three digits', () => {
      assert.equal(formatSessionId('20260131', 1), 'BR-20260131-001');
      assert.equal(formatSessionId('20260131', 42), 'BR-20260131-042');
      assert.equal(formatSessionId('20260131', 999), 'BR-20260131-999');
      assert.equal(formatSessionId('20260131', 1000), 'BR-20260131-1000');
    });

    it('rejects out-of-range sequence numbers', () => {
      assert.throws(() => formatSessionId('20260131', 0), RangeError);
      assert.throws(() => formatSessionId('20260131', MAX_SEQUENCE + 1), RangeError);
      assert.throws(() => formatSessionId('20260131', 1.5), RangeError);
    });
  });

  describe('allocation', () => {
    it('increments monotonically across consecutive calls', async () => {
      const { allocator, driver } = await createHarness({
        now: () => new Date(Date.UTC(2026, 0, 31, 12, 0, 0)),
      });

      assert.equal(await allocator.next(), 'BR-20260131-001');
      assert.equal(await allocator.next(), 'BR-20260131-002');
      assert.equal(await allocator.next(), 'BR-20260131-003');

      const persisted = await driver.readText(`${HISTORY_ROOT}/${DEFAULT_SEQUENCE_FILE}`);
      assert.equal(persisted, '{\n  "date": "20260131",\n  "sequence": 3\n}\n');
    });

    it('produces strictly increasing ids when calls are concurrent', async () => {
      const { allocator } = await createHarness({
        now: () => new Date(Date.UTC(2026, 0, 31, 12, 0, 0)),
      });

      const ids = await Promise.all([allocator.next(), allocator.next(), allocator.next()]);

      assert.deepEqual(ids, ['BR-20260131-001', 'BR-20260131-002', 'BR-20260131-003']);
    });

    it('resets the sequence at a UTC day boundary', async () => {
      let current = new Date(Date.UTC(2026, 0, 31, 23, 59, 59));
      const { allocator } = await createHarness({ now: () => current });

      assert.equal(await allocator.next(), 'BR-20260131-001');
      assert.equal(await allocator.next(), 'BR-20260131-002');

      current = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));

      assert.equal(await allocator.next(), 'BR-20260201-001');
      assert.equal(await allocator.next(), 'BR-20260201-002');
    });

    it('preserves the sequence across allocator restarts', async () => {
      const driver = new InMemoryStorageDriver();
      const clock = { now: (): Date => new Date(Date.UTC(2026, 0, 31, 12, 0, 0)) };

      const first = await createHarness(clock, driver);
      assert.equal(await first.allocator.next(), 'BR-20260131-001');
      assert.equal(await first.allocator.next(), 'BR-20260131-002');

      const second = await createHarness(clock, driver);
      assert.equal(await second.allocator.next(), 'BR-20260131-003');
    });

    it('rejects allocation when the daily sequence is exhausted', async () => {
      const fileSystem = new BrudFileSystem(HISTORY_ROOT, new InMemoryStorageDriver());
      await fileSystem.initialize();
      await fileSystem.writeAtomic(
        DEFAULT_SEQUENCE_FILE,
        `${JSON.stringify({ date: '20260131', sequence: MAX_SEQUENCE })}\n`,
      );
      const allocator = new IdAllocator(fileSystem, {
        now: () => new Date(Date.UTC(2026, 0, 31, 12, 0, 0)),
      });

      await assert.rejects(
        allocator.next(),
        (error: unknown) => error instanceof IdSequenceOverflowError
          && error.date === '20260131'
          && error.maxSequence === MAX_SEQUENCE,
      );
    });

    it('recovers from a malformed counter file', async () => {
      const fileSystem = new BrudFileSystem(HISTORY_ROOT, new InMemoryStorageDriver());
      await fileSystem.initialize();
      await fileSystem.writeAtomic(DEFAULT_SEQUENCE_FILE, '{not json');
      const allocator = new IdAllocator(fileSystem, {
        now: () => new Date(Date.UTC(2026, 0, 31, 12, 0, 0)),
      });

      assert.equal(await allocator.next(), 'BR-20260131-001');
    });

    it('honours a custom sequence file name', async () => {
      const { allocator, driver } = await createHarness({
        now: () => new Date(Date.UTC(2026, 0, 31, 12, 0, 0)),
        sequenceFile: 'counters/session.json',
      });

      assert.equal(await allocator.next(), 'BR-20260131-001');
      assert.equal(await driver.exists(`${HISTORY_ROOT}/counters/session.json`), true);
    });
  });
});
