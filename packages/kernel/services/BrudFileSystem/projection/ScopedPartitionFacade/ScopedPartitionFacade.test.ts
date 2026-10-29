import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../orchestrator/BrudFileSystem.js';
import { PathTraversalViolationError } from '../../validation/PathValidator/PathValidator.js';
import { ReadOnlyProjectionViolationError, ScopedPartitionFacade } from './ScopedPartitionFacade.js';

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
  const facade = new ScopedPartitionFacade(service, '.brud/work');
  return { facade, service };
}

function isReadOnlyViolation(error: unknown): boolean {
  return error instanceof ReadOnlyProjectionViolationError
    && error.rule === 'INPUT.READ_ONLY_PROJECTION'
    && error.code === 'VALIDATION_ERROR';
}

describe('ScopedPartitionFacade', () => {
  it('normalises the partition prefix', async () => {
    const { facade } = await createFacade();

    assert.equal(facade.partitionPrefix, '.brud/work');
    assert.equal(
      new ScopedPartitionFacade(facade, 'nested\\partition').partitionPrefix,
      'nested/partition',
    );
  });

  it('pins file writes to the partition prefix', async () => {
    const { facade, service } = await createFacade();

    await facade.createFile('sessions/one.json', '{"id":1}');

    assert.equal(await service.readText('.brud/work/sessions/one.json'), '{"id":1}');
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
    await service.createFile('.brud/work/root.txt', 'root');

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

  it('serves reads through a read-only projection', async () => {
    const { service } = await createFacade();
    await service.createFile('.brud/work/sessions/one.json', '{"id":1}');

    const readOnly = new ScopedPartitionFacade(service, '.brud/work', { readOnly: true });

    assert.equal(readOnly.isReadOnly, true);
    assert.equal(await readOnly.readText('sessions/one.json'), '{"id":1}');
    assert.equal(await readOnly.exists('sessions/one.json'), true);
    assert.deepEqual(await readOnly.readDirectory('sessions'), [
      { name: 'one.json', isFile: true, isDirectory: false },
    ]);
  });

  it('rejects every mutation on a read-only projection with INPUT.READ_ONLY_PROJECTION', async () => {
    const { service } = await createFacade();
    await service.createFile('.brud/work/existing.txt', 'keep');

    const readOnly = new ScopedPartitionFacade(service, '.brud/work', { readOnly: true });

    await assert.rejects(readOnly.writeAtomic('existing.txt', 'changed'), isReadOnlyViolation);
    await assert.rejects(readOnly.createFile('new.txt', 'new'), isReadOnlyViolation);
    await assert.rejects(readOnly.deleteFile('existing.txt'), isReadOnlyViolation);

    assert.equal(await readOnly.readText('existing.txt'), 'keep');
    assert.equal(await readOnly.exists('new.txt'), false);
  });

  it('names the attempted mutation and target in the projection failure', async () => {
    const { facade } = await createFacade();
    const readOnly = new ScopedPartitionFacade(facade, '.brud/work', { readOnly: true });

    await assert.rejects(readOnly.createFile('reports/a.json', 'x'), (error: unknown) => {
      assert.ok(error instanceof ReadOnlyProjectionViolationError);
      assert.equal(error.operationKind, 'createFile');
      assert.equal(error.path, 'reports/a.json');
      assert.match(error.message, /cannot mutate a read-only projection/);
      return true;
    });
  });

  it('leaves a writable projection unaffected by the projection gate', async () => {
    const { facade, service } = await createFacade();

    assert.equal(facade.isReadOnly, false);

    await facade.createFile('writable.txt', 'ok');

    assert.equal(await service.readText('.brud/work/writable.txt'), 'ok');
  });
});
