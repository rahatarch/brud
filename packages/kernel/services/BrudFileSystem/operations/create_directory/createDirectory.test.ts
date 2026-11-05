import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from '../../events/FileMutationJournal.js';
import type { FileMutationEvent } from '../../events/types.js';
import { BrudFileSystem } from '../../orchestrator/BrudFileSystem.js';
import { WorkspaceViolationError } from '../../../WorkspaceService/contracts/errors.js';
import { FileSystemError } from '../shared/errors.js';
import { createDirectory } from './createDirectory.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-create-directory-')));
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
  override async createDirectory(_absolutePath: string): Promise<void> {
    throw errnoError('EACCES');
  }
}

describe('createDirectory operation', () => {
  it('creates intermediate directories and reports creation', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'deep/nested/directory');

    const created = await createDirectory(driver, target);

    assert.equal(created, true);
    const stats = await driver.stat(target);
    assert.ok(stats);
    assert.equal(stats.isDirectory, true);
  });

  it('is idempotent for an existing directory', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'directory');

    assert.equal(await createDirectory(driver, target), true);
    assert.equal(await createDirectory(driver, target), false);
  });

  it('rejects an existing file with CONFLICT', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'payload');

    await assert.rejects(
      createDirectory(driver, target),
      hasFileSystemCode('CONFLICT'),
    );
  });

  it('maps a permission failure to EACCES', async () => {
    const driver = new PermissionDeniedDriver();

    await assert.rejects(
      createDirectory(driver, join(root, 'directory')),
      hasFileSystemCode('EACCES'),
    );
  });

  it('rejects paths outside the workspace', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.createDirectory('../outside'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.code === 'WORKSPACE_PATH_VIOLATION',
    );
  });

  it('rejects protected paths', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.createDirectory('.git/hooks'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.createDirectory('.brud/history/session'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.createDirectory('.brud/settings.json'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
  });

  it('serializes concurrent creations of the same directory', async () => {
    const { service, driver } = await createService();

    const outcomes = await Promise.allSettled([
      service.createDirectory('shared/nested'),
      service.createDirectory('shared/nested'),
    ]);

    assert.equal(outcomes.every((outcome) => outcome.status === 'fulfilled'), true);
    const stats = await driver.stat(join(root, 'shared/nested'));
    assert.ok(stats);
    assert.equal(stats.isDirectory, true);
  });

  it('publishes created_directory journal descriptors', async () => {
    const { service, events } = await createService();

    await service.createDirectory('new/directory');
    await flushJournal();

    const created = events.filter((event) => event.operation === 'created_directory');

    assert.equal(created.length, 2);
    assert.equal(created[0]?.phase, 'before');
    assert.equal(created[0]?.path, 'new/directory');
    assert.equal(created[0]?.previous.kind, 'missing');
    assert.equal(created[0]?.updated.kind, 'directory');
    assert.equal(created[1]?.phase, 'after');
    assert.equal(created[1]?.updated.kind, 'directory');
    assert.equal(created[0]?.mutationId, created[1]?.mutationId);
  });

  it('does not publish a descriptor when the directory already exists', async () => {
    const { service, events } = await createService();

    await service.createDirectory('existing');
    await flushJournal();
    events.length = 0;

    await service.createDirectory('existing');
    await flushJournal();

    assert.deepEqual(events, []);
  });
});