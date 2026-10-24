import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageDriver } from './NodeStorageDriver.js';

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

describe('NodeStorageDriver', () => {
  const driver = new NodeStorageDriver();
  let rootDirectory = '';
  let caseDirectory = '';

  before(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'brud-node-driver-'));
  });

  beforeEach(async () => {
    caseDirectory = await mkdtemp(join(rootDirectory, 'case-'));
  });

  afterEach(async () => {
    await rm(caseDirectory, { recursive: true, force: true });
  });

  after(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('writes, reads, and stats a text file on disk', async () => {
    const path = join(caseDirectory, 'message.txt');

    await driver.writeFile(path, 'hello disk');

    assert.equal(await driver.exists(path), true);
    assert.equal(await driver.readText(path), 'hello disk');

    const bytes = await driver.readFile(path);
    assert.deepEqual(Array.from(bytes), Array.from(Buffer.from('hello disk', 'utf8')));

    const stats = await driver.stat(path);
    assert.ok(stats);
    assert.equal(stats.isFile, true);
    assert.equal(stats.isDirectory, false);
    assert.equal(stats.size, Buffer.byteLength('hello disk', 'utf8'));
    assert.ok(stats.mtimeMs > 0);
  });

  it('round-trips binary data on disk', async () => {
    const path = join(caseDirectory, 'payload.bin');
    const payload = Uint8Array.from([0, 255, 1, 254, 128]);

    await driver.writeFile(path, payload);

    const result = await driver.readFile(path);
    assert.deepEqual(Array.from(result), Array.from(payload));
  });

  it('creates directories recursively and lists their children', async () => {
    const intermediate = join(caseDirectory, 'nested');
    const nested = join(intermediate, 'deep');

    await driver.mkdir(nested, { recursive: true });
    await driver.writeFile(join(nested, 'file.txt'), 'content');

    const nestedStats = await driver.stat(nested);
    assert.ok(nestedStats);
    assert.equal(nestedStats.isDirectory, true);

    const rootEntries = await driver.readDir(caseDirectory);
    assert.deepEqual(rootEntries, [{ name: 'nested', isFile: false, isDirectory: true }]);

    const intermediateEntries = await driver.readDir(intermediate);
    assert.deepEqual(intermediateEntries, [{ name: 'deep', isFile: false, isDirectory: true }]);

    const nestedEntries = await driver.readDir(nested);
    assert.deepEqual(nestedEntries, [{ name: 'file.txt', isFile: true, isDirectory: false }]);
  });

  it('renames a file and removes the source', async () => {
    const source = join(caseDirectory, 'source.txt');
    const target = join(caseDirectory, 'target.txt');

    await driver.writeFile(source, 'renamed content');
    await driver.rename(source, target);

    assert.equal(await driver.exists(source), false);
    assert.equal(await driver.exists(target), true);
    assert.equal(await driver.readText(target), 'renamed content');
  });

  it('deletes a file', async () => {
    const path = join(caseDirectory, 'ephemeral.txt');

    await driver.writeFile(path, 'temporary');
    await driver.deleteFile(path);

    assert.equal(await driver.exists(path), false);
    assert.equal(await driver.stat(path), null);
  });

  it('returns null for a nonexistent path without throwing', async () => {
    const missing = join(caseDirectory, 'missing.txt');

    assert.equal(await driver.stat(missing), null);
    assert.equal(await driver.exists(missing), false);
  });

  it('propagates ENOENT when reading a nonexistent file', async () => {
    await assert.rejects(
      driver.readFile(join(caseDirectory, 'missing.txt')),
      (error: unknown) => errorCode(error) === 'ENOENT',
    );
  });

  it('resolves real paths for regular files and directories', async () => {
    const file = join(caseDirectory, 'real.txt');
    const directory = join(caseDirectory, 'real-directory');

    await driver.writeFile(file, 'content');
    await driver.mkdir(directory);

    assert.equal(await driver.realpath(file), await realpath(file));
    assert.equal(await driver.realpath(directory), await realpath(directory));
  });

  it('resolves symlinks to their canonical targets', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symlink creation requires elevated privileges on win32');
      return;
    }

    const target = join(caseDirectory, 'target.txt');
    const link = join(caseDirectory, 'link.txt');

    await driver.writeFile(target, 'linked content');
    await symlink(target, link);

    assert.equal(await driver.realpath(link), await realpath(target));
  });

  it('reports symlinks, dangling symlinks, and plain entries through lstat', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symlink creation requires elevated privileges on win32');
      return;
    }

    const target = join(caseDirectory, 'target.txt');
    const link = join(caseDirectory, 'link.txt');
    const dangling = join(caseDirectory, 'dangling.txt');

    await driver.writeFile(target, 'linked content');
    await symlink(target, link);
    await symlink(join(caseDirectory, 'missing.txt'), dangling);

    assert.deepEqual(await driver.lstat(link), { isSymbolicLink: true });
    assert.deepEqual(await driver.lstat(dangling), { isSymbolicLink: true });
    assert.deepEqual(await driver.lstat(target), { isSymbolicLink: false });
    assert.equal(await driver.lstat(join(caseDirectory, 'missing.txt')), null);
  });
});
