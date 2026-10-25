import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { InMemoryStorageDriver, StorageError } from '../../../drivers/memory/index.js';
import { createFileMutationJournal } from '../events/FileMutationJournal.js';
import type { FileMutationEvent } from '../events/types.js';
import { CommittedWithDurabilityWarningError } from '../operations/shared/errors.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

class AccessDeniedDriver extends InMemoryStorageDriver {
  override async writeFileExclusive(
    absolutePath: string,
    _data: Uint8Array | string,
    _options?: { readonly mode?: number },
  ): Promise<void> {
    throw new StorageError('EACCES', 'open', absolutePath);
  }
}

class DirectorySyncFailingDriver extends InMemoryStorageDriver {
  async syncDirectory(_absoluteDirectoryPath: string): Promise<void> {
    throw new Error('directory fsync unavailable');
  }
}

async function flushJournal(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function createHarness(driver: InMemoryStorageDriver): Promise<{
  service: BrudFileSystem;
  events: FileMutationEvent[];
}> {
  const journal = createFileMutationJournal();
  const service = new BrudFileSystem('/workspace', driver, { mutationJournal: journal });
  const events: FileMutationEvent[] = [];

  await service.initialize();
  service.onMutation((event) => {
    events.push(event);
  });

  return { service, events };
}

describe('journal atomicity (V-6)', () => {
  it('emits zero records when staging fails with EACCES', async () => {
    const { service, events } = await createHarness(new AccessDeniedDriver());

    await assert.rejects(service.writeAtomic('denied.txt', 'payload'), (error: unknown) => {
      return error instanceof Error && (error as { readonly code?: unknown }).code === 'EACCES';
    });
    await flushJournal();

    assert.deepEqual(events, []);
  });

  it('emits zero records for a no-op deletion', async () => {
    const { service, events } = await createHarness(new InMemoryStorageDriver());

    await service.deleteFile('missing.txt');
    await flushJournal();

    assert.deepEqual(events, []);
  });
});

describe('commit/durability split-brain (V-7)', () => {
  it('reports committed-with-warning when fsync fails after the rename', async () => {
    const { service, events } = await createHarness(new DirectorySyncFailingDriver());

    await assert.rejects(
      service.writeAtomic('committed.txt', 'payload'),
      (error: unknown) => error instanceof CommittedWithDurabilityWarningError
        && error.committed === true
        && error.fsyncError instanceof Error,
    );
    await flushJournal();

    assert.equal(await service.readText('committed.txt'), 'payload');

    const writeEvents = events.filter((event) => event.operation === 'write');

    assert.equal(writeEvents.length, 2);
    assert.equal(writeEvents[0]?.phase, 'before');
    assert.equal(writeEvents[1]?.phase, 'after');
    assert.equal(writeEvents[1]?.status, 'committed_with_durability_warning');
    assert.equal(writeEvents[1]?.committed, true);
    assert.ok(writeEvents[1]?.error instanceof Error);
  });
});

describe('startup staging sweep (V-8)', () => {
  it('removes orphan staging files whose owning process is gone', async () => {
    const driver = new InMemoryStorageDriver();
    await driver.mkdir('/workspace', { recursive: true });

    const orphan = `/workspace/.report.txt.999999.${randomUUID()}.tmp`;
    const live = `/workspace/.report.txt.${process.pid}.${randomUUID()}.tmp`;
    const unrelated = '/workspace/.report.txt.tmp';

    await driver.writeFile(orphan, 'orphan');
    await driver.writeFile(live, 'live');
    await driver.writeFile(unrelated, 'user file');

    const service = new BrudFileSystem('/workspace', driver);
    await service.initialize();

    assert.equal(await driver.exists(orphan), false);
    assert.equal(await driver.exists(live), true);
    assert.equal(await driver.exists(unrelated), true);
  });

  it('sweeps old staging files even when the pid was reused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brud-sweep-old-'));

    try {
      const oldStaging = join(root, `.old.txt.${process.pid}.${randomUUID()}.tmp`);
      await writeFile(oldStaging, 'old');

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(oldStaging, twoHoursAgo, twoHoursAgo);

      const service = new BrudFileSystem(root, new NodeStorageDriver());
      await service.initialize();

      await assert.rejects(access(oldStaging));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
