import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { createFileMutationJournal } from '../events/FileMutationJournal.js';
import type { FileMutationEvent } from '../events/types.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

const ROOT = '/workspace';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function flushJournal(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function createHarness(options?: {
  onListenerError?: (error: unknown, event: FileMutationEvent) => void;
  subscribe?: boolean;
}): Promise<{
  service: BrudFileSystem;
  events: FileMutationEvent[];
  journal: ReturnType<typeof createFileMutationJournal>;
}> {
  const journal = createFileMutationJournal(
    options?.onListenerError === undefined
      ? undefined
      : { onListenerError: options.onListenerError },
  );
  const service = new BrudFileSystem(ROOT, new InMemoryStorageDriver(), {
    mutationJournal: journal,
  });
  const events: FileMutationEvent[] = [];

  await service.initialize();

  if (options?.subscribe !== false) {
    service.onMutation((event) => {
      events.push(event);
    });
  }

  return { service, events, journal };
}

describe('BrudFileSystem mutation journal', () => {
  it('publishes pre/post write descriptors with previous and updated hashes', async () => {
    const { service, events } = await createHarness();

    await service.writeAtomic('docs/note.txt', 'first');
    await flushJournal();

    const firstWrite = events.filter(
      (event) => event.operation === 'write' && event.path === 'docs/note.txt',
    );

    assert.equal(firstWrite.length, 2);
    const [before, after] = firstWrite;

    assert.ok(before);
    assert.ok(after);
    assert.equal(before.phase, 'before');
    assert.equal(after.phase, 'after');
    assert.equal(before.mutationId, after.mutationId);
    assert.equal(before.previous.exists, false);
    assert.equal(before.previous.kind, 'missing');
    assert.equal(before.updated.sha256, digest('first'));
    assert.equal(after.previous.exists, false);
    assert.equal(after.updated.sha256, digest('first'));
    assert.equal(after.updated.size, 5);

    events.length = 0;
    await service.writeAtomic('docs/note.txt', 'second');
    await flushJournal();

    const secondWrite = events.filter((event) => event.operation === 'write');

    assert.equal(secondWrite.length, 2);
    assert.equal(secondWrite[0]?.previous.sha256, digest('first'));
    assert.equal(secondWrite[0]?.updated.sha256, digest('second'));
    assert.equal(secondWrite[1]?.updated.sha256, digest('second'));
  });

  it('publishes mkdir descriptors for implicit parent directories', async () => {
    const { service, events } = await createHarness();

    await service.writeAtomic('deep/nested/file.txt', 'payload');
    await flushJournal();

    const mkdirEvents = events.filter((event) => event.operation === 'mkdir');

    assert.equal(mkdirEvents.length, 2);
    assert.equal(mkdirEvents[0]?.path, 'deep/nested');
    assert.equal(mkdirEvents[0]?.phase, 'before');
    assert.equal(mkdirEvents[0]?.previous.kind, 'missing');
    assert.equal(mkdirEvents[0]?.updated.kind, 'directory');
    assert.equal(mkdirEvents[1]?.phase, 'after');
    assert.equal(mkdirEvents[1]?.updated.kind, 'directory');
    assert.equal(mkdirEvents[0]?.mutationId, mkdirEvents[1]?.mutationId);
  });

  it('describes createFile as a write and deleteFile as an unlink', async () => {
    const { service, events } = await createHarness();

    await service.createFile('created.txt', 'fresh');
    await flushJournal();

    events.length = 0;
    await service.deleteFile('created.txt');
    await flushJournal();

    const unlinkEvents = events.filter((event) => event.operation === 'unlink');

    assert.equal(unlinkEvents.length, 2);
    assert.equal(unlinkEvents[0]?.path, 'created.txt');
    assert.equal(unlinkEvents[0]?.previous.sha256, digest('fresh'));
    assert.equal(unlinkEvents[0]?.updated.exists, false);
    assert.equal(unlinkEvents[1]?.updated.kind, 'missing');
  });

  it('never lets a failing listener break a mutation', async () => {
    const errors: unknown[] = [];
    const { service } = await createHarness({
      onListenerError: (error) => {
        errors.push(error);
      },
    });

    service.onMutation(() => {
      throw new Error('history subscriber failed');
    });

    await service.writeAtomic('resilient.txt', 'payload');
    await flushJournal();

    assert.equal(await service.readText('resilient.txt'), 'payload');
    assert.equal(errors.length, 2);
    assert.ok(errors[0] instanceof Error);
    assert.equal((errors[0] as Error).message, 'history subscriber failed');
  });

  it('stops publishing after a listener unsubscribes', async () => {
    const { service, events } = await createHarness({ subscribe: false });

    const unsubscribe = service.onMutation((event) => {
      events.push(event);
    });

    unsubscribe();

    await service.writeAtomic('quiet.txt', 'payload');
    await flushJournal();

    assert.deepEqual(events, []);
  });
});
