import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from '../../events/FileMutationJournal.js';
import type { FileMutationEvent } from '../../events/types.js';
import { BrudFileSystem } from '../../orchestrator/BrudFileSystem.js';
import { WorkspaceViolationError } from '../../../WorkspaceService/contracts/errors.js';
import { FileSystemError } from '../shared/errors.js';
import { deleteDirectory } from './deleteDirectory.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-delete-directory-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function hasFileSystemCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof FileSystemError && error.code === code;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function flushJournal(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function createService(): Promise<{
  service: BrudFileSystem;
  driver: DurableNodeStorageDriver;
  events: FileMutationEvent[];
}> {
  const driver = new DurableNodeStorageDriver();
  const journal = createFileMutationJournal();
  const service = new BrudFileSystem(root, driver, { mutationJournal: journal });
  const events: FileMutationEvent[] = [];

  await service.initialize();
  service.onMutation((event) => {
    events.push(event);
  });

  return { service, driver, events };
}

class PermissionDeniedDriver extends DurableNodeStorageDriver {
  override async deleteDirectory(_absolutePath: string): Promise<void> {
    throw errnoError('EACCES');
  }
}

describe('deleteDirectory operation', () => {
  it('deletes a nested directory tree recursively', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'tree');
    await driver.mkdir(join(target, 'nested/deeper'), { recursive: true });
    await driver.writeFile(join(target, 'nested/deeper/file.txt'), 'payload');

    const deleted = await deleteDirectory(driver, target);

    assert.equal(deleted, true);
    assert.equal(await driver.exists(target), false);
    assert.equal(await driver.exists(join(target, 'nested/deeper/file.txt')), false);
  });

  it('is idempotent for a missing directory', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'missing');

    assert.equal(await deleteDirectory(driver, target), false);
    assert.equal(await deleteDirectory(driver, target), false);
  });

  it('rejects a file with CANNOT_DELETE_FILE_AS_DIRECTORY', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'payload');

    await assert.rejects(
      deleteDirectory(driver, target),
      hasFileSystemCode('CANNOT_DELETE_FILE_AS_DIRECTORY'),
    );
    assert.equal(await driver.readText(target), 'payload');
  });

  it('maps a permission failure to EACCES', async () => {
    const driver = new PermissionDeniedDriver();
    const target = join(root, 'tree');
    await driver.mkdir(target);

    await assert.rejects(
      deleteDirectory(driver, target),
      hasFileSystemCode('EACCES'),
    );
  });

  it('rejects paths outside the workspace', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.deleteDirectory('../outside'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.code === 'WORKSPACE_PATH_VIOLATION',
    );
  });

  it('rejects protected paths', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.deleteDirectory('.git'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.deleteDirectory('.brud/history'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.deleteDirectory('.brud/settings.json'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
  });

  it('serializes concurrent deletions of the same directory', async () => {
    const { service, driver } = await createService();
    await driver.mkdir(join(root, 'shared'), { recursive: true });

    const outcomes = await Promise.allSettled([
      service.deleteDirectory('shared'),
      service.deleteDirectory('shared'),
    ]);

    assert.equal(outcomes.every((outcome) => outcome.status === 'fulfilled'), true);
    assert.equal(await driver.exists(join(root, 'shared')), false);
  });

  it('rejects deleting a file through deleteDirectory', async () => {
    const { service, driver } = await createService();
    await driver.writeFile(join(root, 'file.txt'), 'payload');

    await assert.rejects(
      service.deleteDirectory('file.txt'),
      hasFileSystemCode('CANNOT_DELETE_FILE_AS_DIRECTORY'),
    );
  });

  it('publishes deleted_directory descriptors and captures file pre-state', async () => {
    const { service, driver, events } = await createService();
    await driver.mkdir(join(root, 'tree/nested'), { recursive: true });
    await writeFile(join(root, 'tree/alpha.txt'), 'alpha');
    await writeFile(join(root, 'tree/nested/beta.txt'), 'beta');

    await service.deleteDirectory('tree');
    await flushJournal();

    const deleted = events.filter((event) => event.operation === 'deleted_directory');
    const unlinks = events
      .filter((event) => event.operation === 'unlink')
      .sort((left, right) => left.path.localeCompare(right.path));

    assert.equal(deleted.length, 2);
    assert.equal(deleted[0]?.phase, 'before');
    assert.equal(deleted[0]?.path, 'tree');
    assert.equal(deleted[0]?.previous.kind, 'directory');
    assert.equal(deleted[0]?.updated.kind, 'missing');
    assert.equal(deleted[1]?.phase, 'after');
    assert.equal(deleted[0]?.mutationId, deleted[1]?.mutationId);

    assert.deepEqual(
      unlinks.map((event) => [event.path, event.previous.sha256]),
      [
        ['tree/alpha.txt', digest('alpha')],
        ['tree/nested/beta.txt', digest('beta')],
      ],
    );
    assert.equal(unlinks.every((event) => event.phase === 'before'), true);
    assert.equal(unlinks.every((event) => event.mutationId === deleted[0]?.mutationId), true);
  });
});