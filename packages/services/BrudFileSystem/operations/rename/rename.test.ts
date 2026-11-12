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
import { rename } from './rename.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-rename-')));
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
  override async rename(_sourcePath: string, _targetPath: string): Promise<void> {
    throw errnoError('EACCES');
  }
}

class CrossDeviceDriver extends DurableNodeStorageDriver {
  protected override async renameNative(
    _sourcePath: string,
    _targetPath: string,
  ): Promise<void> {
    throw errnoError('EXDEV');
  }
}

describe('rename operation', () => {
  it('renames a file and removes the source', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'payload');

    await rename(driver, source, destination);

    assert.equal(await driver.readText(destination), 'payload');
    assert.equal(await driver.exists(source), false);
  });

  it('preserves file mode', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'payload');
    await chmod(source, 0o640);

    await rename(driver, source, destination);

    const stats = await driver.stat(destination);
    assert.ok(stats);
    assert.equal(stats.mode, 0o640);
  });

  it('rejects a missing source with FILE_NOT_FOUND', async () => {
    const driver = new DurableNodeStorageDriver();

    await assert.rejects(
      rename(driver, join(root, 'missing.txt'), join(root, 'destination.txt')),
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
      rename(driver, source, destination),
      hasFileSystemCode('CONFLICT'),
    );

    assert.equal(await driver.readText(destination), 'destination');
    assert.equal(await driver.readText(source), 'source');
  });

  it('rejects a missing destination parent with PARENT_NOT_FOUND', async () => {
    const driver = new DurableNodeStorageDriver();
    const source = join(root, 'source.txt');
    await driver.writeFile(source, 'payload');

    await assert.rejects(
      rename(driver, source, join(root, 'missing/destination.txt')),
      hasFileSystemCode('PARENT_NOT_FOUND'),
    );
  });

  it('maps a permission failure to EACCES', async () => {
    const driver = new PermissionDeniedDriver();
    const source = join(root, 'source.txt');
    await driver.writeFile(source, 'payload');

    await assert.rejects(
      rename(driver, source, join(root, 'destination.txt')),
      hasFileSystemCode('EACCES'),
    );
  });

  it('falls back to copy plus delete on EXDEV', async () => {
    const driver = new CrossDeviceDriver();
    const source = join(root, 'source.txt');
    const destination = join(root, 'destination.txt');
    await driver.writeFile(source, 'payload');

    await rename(driver, source, destination);

    assert.equal(await driver.readText(destination), 'payload');
    assert.equal(await driver.exists(source), false);
  });

  it('rejects paths outside the workspace', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.rename('../outside.txt', 'inside.txt'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.code === 'WORKSPACE_PATH_VIOLATION',
    );
  });

  it('rejects protected source and destination paths', async () => {
    const { service } = await createService();

    await assert.rejects(
      service.rename('.git/config', 'config.txt'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.rename('source.txt', '.brud/settings.json'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
    await assert.rejects(
      service.rename('.brud/history/seq.json', 'seq.json'),
      (error: unknown) => error instanceof WorkspaceViolationError
        && error.rule === 'PROTECTED_PATH_DENIED',
    );
  });

  it('serializes concurrent renames of the same source', async () => {
    const { service, driver } = await createService();
    await driver.writeFile(join(root, 'source.txt'), 'payload');

    const outcomes = await Promise.allSettled([
      service.rename('source.txt', 'target-b.txt'),
      service.rename('source.txt', 'target-c.txt'),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(
      reason instanceof FileSystemError && reason.code === 'FILE_NOT_FOUND',
      true,
    );
  });

  it('publishes renamed journal descriptors with source and destination paths', async () => {
    const { service, driver, events } = await createService();
    await driver.writeFile(join(root, 'source.txt'), 'payload');

    await service.rename('source.txt', 'destination.txt');
    await flushJournal();

    const renamed = events.filter((event) => event.operation === 'renamed');

    assert.equal(renamed.length, 2);
    assert.equal(renamed[0]?.phase, 'before');
    assert.equal(renamed[0]?.path, 'source.txt');
    assert.equal(renamed[0]?.sourcePath, 'source.txt');
    assert.equal(renamed[0]?.destinationPath, 'destination.txt');
    assert.equal(renamed[0]?.previous.sha256, digest('payload'));
    assert.equal(renamed[1]?.phase, 'after');
    assert.equal(renamed[1]?.path, 'destination.txt');
    assert.equal(renamed[1]?.updated.sha256, digest('payload'));
    assert.equal(renamed[0]?.mutationId, renamed[1]?.mutationId);
  });

  it('rejects a symlink target that escapes the workspace', async () => {
    const { service } = await createService();
    const outside = await mkdtemp(join(tmpdir(), 'brud-rename-outside-'));
    const escape = join(root, 'escape');

    try {
      await writeFile(join(outside, 'secret.txt'), 'secret');
      await symlink(outside, escape, 'dir');

      await assert.rejects(
        service.rename('escape/secret.txt', 'stolen.txt'),
        (error: unknown) => error instanceof WorkspaceViolationError
          && error.code === 'WORKSPACE_PATH_VIOLATION',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});