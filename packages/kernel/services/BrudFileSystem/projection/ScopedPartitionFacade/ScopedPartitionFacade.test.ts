import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../orchestrator/BrudFileSystem.js';
import { PathTraversalViolationError } from '../../validation/PathValidator/PathValidator.js';
import { ScopedPartitionFacade } from './ScopedPartitionFacade.js';

function isTraversalViolation(error: unknown): boolean {
  return error instanceof PathTraversalViolationError
    && error.code === 'PATH_TRAVERSAL_DETECTED';
}

async function createFacade(): Promise<{
  facade: ScopedPartitionFacade;
  service: BrudFileSystem;
}> {
  const service = new BrudFileSystem('/workspace', new InMemoryStorageDriver());
  await service.initialize();
  const facade = new ScopedPartitionFacade(service, '.brud/history');
  return { facade, service };
}

describe('ScopedPartitionFacade', () => {
  it('normalises the partition prefix', async () => {
    const { facade } = await createFacade();

    assert.equal(facade.partitionPrefix, '.brud/history');
    assert.equal(
      new ScopedPartitionFacade(facade, 'nested\\partition').partitionPrefix,
      'nested/partition',
    );
  });

  it('pins file writes to the partition prefix', async () => {
    const { facade, service } = await createFacade();

    await facade.createFile('sessions/one.json', '{"id":1}');

    assert.equal(await service.readText('.brud/history/sessions/one.json'), '{"id":1}');
    assert.equal(await facade.readText('sessions/one.json'), '{"id":1}');
    assert.equal(await facade.exists('sessions/one.json'), true);
    assert.equal(await service.exists('sessions/one.json'), false);
  });

  it('scopes atomic writes, directory reads, stats, and deletion', async () => {
    const { facade } = await createFacade();

    await facade.writeAtomic('events/log.txt', 'event');
    const stats = await facade.stat('events/log.txt');
    assert.ok(stats);
    assert.equal(stats.isFile, true);

    const entries = await facade.readDirectory('events');
    assert.deepEqual(entries, [{ name: 'log.txt', isFile: true, isDirectory: false }]);

    await facade.deleteFile('events/log.txt');
    assert.equal(await facade.exists('events/log.txt'), false);
  });

  it('maps the facade root to the partition directory', async () => {
    const { facade, service } = await createFacade();
    await service.createFile('.brud/history/root.txt', 'root');

    const entries = await facade.readDirectory('');
    assert.deepEqual(entries, [{ name: 'root.txt', isFile: true, isDirectory: false }]);
  });

  it('prevents prefix escapes through traversal segments', async () => {
    const { facade, service } = await createFacade();

    await assert.rejects(facade.writeAtomic('../escape.txt', 'nope'), isTraversalViolation);
    await assert.rejects(facade.readFile('sessions/../../escape.txt'), isTraversalViolation);
    await assert.rejects(facade.readFile('..\\escape.txt'), isTraversalViolation);
    await assert.rejects(facade.createFile('/etc/passwd', 'nope'), isTraversalViolation);

    assert.equal(await service.exists('escape.txt'), false);
    assert.equal(await service.exists('.brud/escape.txt'), false);
  });

  it('rejects unsafe partition prefixes at construction time', async () => {
    const { facade } = await createFacade();

    assert.throws(() => new ScopedPartitionFacade(facade, '../outside'), isTraversalViolation);
    assert.throws(() => new ScopedPartitionFacade(facade, '/absolute'), isTraversalViolation);
    assert.throws(() => new ScopedPartitionFacade(facade, 'a/../b'), isTraversalViolation);
    assert.throws(() => new ScopedPartitionFacade(facade, '\\\\server\\share'), isTraversalViolation);
    assert.throws(() => new ScopedPartitionFacade(facade, '.'), isTraversalViolation);
    assert.throws(() => new ScopedPartitionFacade(facade, ''), isTraversalViolation);
  });
});
