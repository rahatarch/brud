import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { KeyedWriteMutex } from './KeyedWriteMutex.js';

describe('KeyedWriteMutex', () => {
  it('serializes concurrent operations on the same key in call order', async () => {
    const mutex = new KeyedWriteMutex();
    const events: string[] = [];

    const tasks = [0, 1, 2].map((index) =>
      mutex.runExclusive('shared-key', async () => {
        events.push(`start:${index}`);
        await delay(5);
        events.push(`end:${index}`);
        return index;
      }));

    assert.deepEqual(await Promise.all(tasks), [0, 1, 2]);
    assert.deepEqual(events, [
      'start:0',
      'end:0',
      'start:1',
      'end:1',
      'start:2',
      'end:2',
    ]);
  });

  it('never allows more than one task on a key to run at once', async () => {
    const mutex = new KeyedWriteMutex();
    let active = 0;
    let maxActive = 0;

    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active -= 1;
    };

    await Promise.all(
      Array.from({ length: 6 }, () => mutex.runExclusive('contended', task)),
    );

    assert.equal(maxActive, 1);
  });

  it('runs operations on different keys concurrently', async () => {
    const mutex = new KeyedWriteMutex();
    let active = 0;
    let maxActive = 0;

    const task = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
    };

    await Promise.all([
      mutex.runExclusive('alpha', task),
      mutex.runExclusive('beta', task),
    ]);

    assert.equal(maxActive, 2);
  });

  it('releases the key after a task rejects', async () => {
    const mutex = new KeyedWriteMutex();

    await assert.rejects(
      mutex.runExclusive('recoverable', async () => {
        throw new Error('boom');
      }),
      /boom/,
    );

    assert.equal(
      await mutex.runExclusive('recoverable', async () => 'recovered'),
      'recovered',
    );
  });

  it('queues work behind a failing task without rejecting the next task', async () => {
    const mutex = new KeyedWriteMutex();

    const failing = mutex.runExclusive('queued', async () => {
      await delay(1);
      throw new Error('first failed');
    });
    const following = mutex.runExclusive('queued', async () => 'second');

    await assert.rejects(failing, /first failed/);
    assert.equal(await following, 'second');
  });

  it('rejects empty keys', async () => {
    const mutex = new KeyedWriteMutex();

    await assert.rejects(
      mutex.runExclusive('', async () => 'unreachable'),
      /non-empty key/,
    );
  });
});
