import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { createFileMutationJournal } from '../../events/FileMutationJournal.js';
import type { FileMutationEvent } from '../../events/types.js';
import { BrudFileSystem } from '../../orchestrator/BrudFileSystem.js';
import { WorkspaceViolationError } from '../../../WorkspaceService/contracts/errors.js';
import { FileSystemError } from '../shared/errors.js';
import { copy } from './copy.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-copy-')));
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
  override async copy(_sourcePath: string, _targetPath: string): Promise<void> {
    throw errnoError('EACCES');
  }
}

describe('copy operation', () => {
  it('copies a file and leaves the source intact', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'payload');

    await copy(driver, source, destination);

    assert.equal(await driver.readText(destination), 'payload');
    assert.equal(await driver.readText(source), 'payload');
  });

  it('preserves file mode', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'payload');
    await chmod(source, 0o600);

    await copy(driver, source, destination);

    const stats = await driver.stat(destination);
    assert.ok(stats);
    assert.equal(stats.mode, 0o600);
  });

  it('copies a directory tree recursively', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    await driver.mkdir(join(source, 'nested'), { recursive: true });
    await driver.writeFile(join(source, 'nested/file.txt'), 'payload');

    await copy(driver, source, destination);

    assert.equal(await driver.readText(join(destination, 'nested/file.txt')), 'payload');
  });

  it('rejects a missing source with FILE_NOT_FOUND', async () => {
    const driver = new DurableNodeStorageDriver();

    await assert.rejects(
      copy(driver, join(root, 'missing.txt'), join(root, 'destination.txt')),
      hasFileSystemCode('FILE_NOT_FOUND'),
    );
  });

  it('rejects an existing destination with CONFLICT and leaves it unchanged', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'source');
    await driver.writeFile(destination, 'destination');

    await assert.rejects(
      copy(driver, source, destination),
      hasFileSystemCode('CONFLICT'),
    );

    assert.equal(await driver.readText(destination), 'destination');
  });

  it('rejects a missing destination parent with PARENT_NOT_FOUND', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    await driver.writeFile(source, 'payload');

    await assert.rejects(
      copy(driver, source, join(root, 'missing/destination.txt')),
      hasFileSystemCode('PARENT_NOT_FOUND'),
    );
  });

  it('maps a permission failure to EACCES', async () => {
    const driver = new PermissionDeniedDriver();
    const source = join(root, 'source.txt');
    await driver.writeFile(source, 'payload');

    await assert.rejects(
      copy(driver, source, join(root, 'destination.txt')),
      hasFileSystemCode('EACCES'),
    );
  });

  it('does not follow a symlink at the destination', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    const target = join(root, 'target.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'source');
    await driver.writeFile(target, 'target');
    await symlink(target, destination, 'file');

    await assert.rejects(
      copy(driver, source, destination),
      hasFileSystemCode('CONFLICT'),
    );

    assert.equal(await driver.readText(target), 'target');
    assert.equal(await driver.readText(source), 'source');
  });

  it('rejects paths outside the workspace', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.copy('../outside.txt', 'inside.txt'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.code === 'WORKSPACE_PATH_VIOLATION',
    );
  });

  it('rejects protected source and destination paths', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.copy('.git/config', 'config.txt'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.copy('source.txt', '.brud/settings.json'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.copy('.brud/history/seq.json', 'seq.json'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
  });

  it('serializes concurrent copies to the same destination', async () => {
    const { service, driver } = await createService();
    await driver.writeFile(join(root, 'source.txt'), 'payload');

    const outcomes = await Promise.allSettled([
      service.copy('source.txt', 'target.txt'),
      service.copy('source.txt', 'target.txt'),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(
      reason instanceof FileSystemError && reason.code === 'CONFLICT',
      true,
    );
  });

  it('publishes copied journal descriptors with source and destination paths', async () => {
    const { service, driver, events } = await createService();
    await driver.writeFile(join(root, 'source.txt'), 'payload');

    await service.copy('source.txt', 'destination.txt');
    await flushJournal();

    const copied = events.filter((event) => event.operation === 'copied');

    assert.equal(copied.length, 2);
    assert.equal(copied[0]?.phase, 'before');
    assert.equal(copied[0]?.path, 'destination.txt');
    assert.equal(copied[0]?.sourcePath, 'source.txt');
    assert.equal(copied[0]?.destinationPath, 'destination.txt');
    assert.equal(copied[0]?.updated.sha256, digest('payload'));
    assert.equal(copied[1]?.phase, 'after');
    assert.equal(copied[1]?.updated.sha256, digest('payload'));
    assert.equal(copied[0]?.mutationId, copied[1]?.mutationId);
  });

  it('rejects a destination symlink that escapes the workspace', async () => {
    const { service, driver } = await createService();
    const outside = await mkdtemp(join(tmpdir(), 'brud-copy-outside-'));
    const escape = join(root, 'escape');

    try {
      await driver.writeFile(join(root, 'source.txt'), 'payload');
      await symlink(outside, escape, 'dir');

      await assert.rejects(
        service.copy('source.txt', 'escape/destination.txt'),
        (error: unknown) => error instanceof WorkspaceViolationError
          && error.code === 'WORKSPACE_PATH_VIOLATION',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});