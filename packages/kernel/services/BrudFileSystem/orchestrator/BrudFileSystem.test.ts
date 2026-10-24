import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { FileAlreadyExistsError } from '../operations/shared/errors.js';
import { PathTraversalViolationError } from '../validation/PathValidator/PathValidator.js';
import { BrudFileSystem } from './BrudFileSystem.js';

class RenameFailingDriver extends InMemoryStorageDriver {
  override async rename(_sourcePath: string, _targetPath: string): Promise<void> {
    throw new Error('rename unavailable');
  }
}

function isTraversalViolation(error: unknown): boolean {
  return error instanceof PathTraversalViolationError
    && error.code === 'PATH_TRAVERSAL_DETECTED';
}

function isSymlinkEscape(error: unknown): boolean {
  return isTraversalViolation(error)
    && error instanceof PathTraversalViolationError
    && error.rule === 'SYMLINK_ESCAPE';
}

async function createService(
  driver: InMemoryStorageDriver = new InMemoryStorageDriver(),
): Promise<{ service: BrudFileSystem; driver: InMemoryStorageDriver }> {
  const service = new BrudFileSystem('/workspace', driver);
  await service.initialize();
  return { service, driver };
}

describe('BrudFileSystem', () => {
  describe('lifecycle', () => {
    it('creates the workspace root during initialization', async () => {
      const driver = new InMemoryStorageDriver();
      const service = new BrudFileSystem('/workspace', driver);

      await service.initialize();

      const stats = await driver.stat('/workspace');
      assert.ok(stats);
      assert.equal(stats.isDirectory, true);
      assert.equal(service.workspaceRoot, '/workspace');

      await service.dispose();
    });

    it('remains usable after disposal of the write lock state', async () => {
      const { service } = await createService();

      await service.dispose();
      await service.createFile('after-dispose.txt', 'still works');

      assert.equal(await service.readText('after-dispose.txt'), 'still works');
    });
  });

  describe('file operations', () => {
    it('creates, reads, and inspects a file through relative paths', async () => {
      const { service } = await createService();

      await service.createFile('notes/message.txt', 'hello workspace');

      assert.equal(await service.readText('notes/message.txt'), 'hello workspace');
      assert.deepEqual(
        Array.from(await service.readFile('notes/message.txt')),
        Array.from(Buffer.from('hello workspace', 'utf8')),
      );
      assert.equal(await service.exists('notes/message.txt'), true);

      const stats = await service.stat('notes/message.txt');
      assert.ok(stats);
      assert.equal(stats.isFile, true);
      assert.equal(stats.size, Buffer.byteLength('hello workspace', 'utf8'));
    });

    it('round-trips binary payloads', async () => {
      const { service } = await createService();
      const payload = Uint8Array.from([0, 1, 254, 255]);

      await service.writeAtomic('binary/blob.bin', payload);

      assert.deepEqual(Array.from(await service.readFile('binary/blob.bin')), Array.from(payload));
    });

    it('lists directory entries', async () => {
      const { service } = await createService();

      await service.createFile('tree/alpha/file.txt', 'alpha');
      await service.createFile('tree/beta.txt', 'beta');

      assert.deepEqual(await service.readDirectory('tree'), [
        { name: 'alpha', isFile: false, isDirectory: true },
        { name: 'beta.txt', isFile: true, isDirectory: false },
      ]);
    });

    it('returns null stats and false existence for missing paths', async () => {
      const { service } = await createService();

      assert.equal(await service.stat('missing.txt'), null);
      assert.equal(await service.exists('missing.txt'), false);
    });

    it('deletes files idempotently', async () => {
      const { service } = await createService();
      await service.createFile('ephemeral.txt', 'bye');

      await service.deleteFile('ephemeral.txt');
      await service.deleteFile('ephemeral.txt');

      assert.equal(await service.exists('ephemeral.txt'), false);
    });

    it('honours overwrite protection', async () => {
      const { service } = await createService();
      await service.createFile('protected.txt', 'original');

      await assert.rejects(
        service.createFile('protected.txt', 'replacement', { overwrite: false }),
        (error: unknown) => error instanceof FileAlreadyExistsError,
      );
      assert.equal(await service.readText('protected.txt'), 'original');
    });
  });

  describe('atomic writes', () => {
    it('leaves no staging files behind', async () => {
      const { service, driver } = await createService();

      await service.writeAtomic('reports/summary.txt', 'first');
      await service.writeAtomic('reports/summary.txt', 'second');

      assert.equal(await service.readText('reports/summary.txt'), 'second');
      assert.deepEqual(await service.readDirectory('reports'), [
        { name: 'summary.txt', isFile: true, isDirectory: false },
      ]);
      assert.equal(await driver.exists('/workspace/reports/summary.txt.tmp'), false);
    });

    it('keeps the previous contents when the atomic rename fails', async () => {
      const driver = new RenameFailingDriver();
      const { service } = await createService(driver);
      await service.createFile('reports/summary.txt', 'original');

      await assert.rejects(
        service.writeAtomic('reports/summary.txt', 'replacement'),
        /rename unavailable/,
      );

      assert.equal(await service.readText('reports/summary.txt'), 'original');
      assert.equal(await driver.exists('/workspace/reports/summary.txt.tmp'), false);
    });

    it('serializes concurrent writes to the same path', async () => {
      const { service } = await createService();

      await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          service.writeAtomic('contended.txt', `value-${index}`)),
      );

      const content = await service.readText('contended.txt');
      assert.match(content, /^value-\d+$/);
      assert.deepEqual(await service.readDirectory(''), [
        { name: 'contended.txt', isFile: true, isDirectory: false },
      ]);
    });
  });

  describe('symlink boundary enforcement', () => {
    let rootDirectory = '';

    before(async () => {
      rootDirectory = await mkdtemp(join(tmpdir(), 'brud-fs-symlink-'));
    });

    after(async () => {
      await rm(rootDirectory, { recursive: true, force: true });
    });

    it('blocks reads and writes that escape through a symlink', async (context) => {
      if (process.platform === 'win32') {
        context.skip('symlink creation requires elevated privileges on win32');
        return;
      }

      const workspace = join(rootDirectory, 'workspace');
      const outside = join(rootDirectory, 'outside');
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET');
      await symlink(outside, join(workspace, 'escape'), 'dir');
      const danglingTarget = join(outside, 'created.txt');
      await symlink(danglingTarget, join(workspace, 'dangling'));

      const service = new BrudFileSystem(workspace, new NodeStorageDriver());
      await service.initialize();

      await assert.rejects(service.readFile('escape/secret.txt'), isSymlinkEscape);
      await assert.rejects(service.readText('escape/secret.txt'), isSymlinkEscape);
      await assert.rejects(service.writeAtomic('escape/written.txt', 'nope'), isSymlinkEscape);
      await assert.rejects(service.createFile('escape/created.txt', 'nope'), isSymlinkEscape);
      await assert.rejects(service.deleteFile('escape/secret.txt'), isSymlinkEscape);
      await assert.rejects(service.stat('escape/secret.txt'), isSymlinkEscape);
      await assert.rejects(service.exists('escape/secret.txt'), isSymlinkEscape);
      await assert.rejects(service.readDirectory('escape'), isSymlinkEscape);
      await assert.rejects(service.createFile('dangling', 'nope'), isSymlinkEscape);
      await assert.rejects(service.readFile('dangling'), isSymlinkEscape);
      await assert.rejects(stat(danglingTarget));
    });
  });

  describe('boundary enforcement', () => {
    it('rejects traversal attempts before touching the driver', async () => {
      const { service } = await createService();

      await assert.rejects(service.readFile('../outside.txt'), isTraversalViolation);
      await assert.rejects(service.writeAtomic('../../outside.txt', 'nope'), isTraversalViolation);
      await assert.rejects(service.createFile('/absolute.txt', 'nope'), isTraversalViolation);
      await assert.rejects(service.deleteFile('..\\outside.txt'), isTraversalViolation);
      await assert.rejects(service.stat('nested/../../../outside.txt'), isTraversalViolation);
      await assert.rejects(service.exists('notes/\0hidden.txt'), isTraversalViolation);

      assert.equal(await service.exists('outside.txt'), false);
    });
  });
});
