import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from './InMemoryStorageDriver.js';

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

describe('InMemoryStorageDriver', () => {
  describe('file lifecycle', () => {
    it('writes, checks, reads, and stats a text file', async () => {
      const driver = new InMemoryStorageDriver();
      const path = '/workspace/notes/message.txt';

      await driver.mkdir('/workspace/notes', { recursive: true });
      await driver.writeFile(path, 'hello kernel');

      assert.equal(await driver.exists(path), true);

      const text = await driver.readText(path);
      assert.equal(text, 'hello kernel');

      const bytes = await driver.readFile(path);
      assert.deepEqual(Array.from(bytes), Array.from(Buffer.from('hello kernel', 'utf8')));

      const stats = await driver.stat(path);
      assert.ok(stats);
      assert.equal(stats.isFile, true);
      assert.equal(stats.isDirectory, false);
      assert.equal(stats.size, Buffer.byteLength('hello kernel', 'utf8'));
      assert.ok(stats.mtimeMs > 0);
    });

    it('round-trips binary data', async () => {
      const driver = new InMemoryStorageDriver();
      const path = '/binary.bin';
      const payload = Uint8Array.from([0, 255, 1, 254, 128]);

      await driver.writeFile(path, payload);
      const result = await driver.readFile(path);

      assert.deepEqual(Array.from(result), Array.from(payload));
    });

    it('honours an explicit text encoding', async () => {
      const driver = new InMemoryStorageDriver();
      const path = '/encoded.txt';

      await driver.writeFile(path, 'hello');
      assert.equal(await driver.readText(path, 'base64'), Buffer.from('hello').toString('base64'));
    });

    it('returns a copy that cannot mutate stored data', async () => {
      const driver = new InMemoryStorageDriver();
      const path = '/immutable.bin';

      await driver.writeFile(path, Uint8Array.from([1, 2, 3]));
      const first = await driver.readFile(path);
      first[0] = 99;

      const second = await driver.readFile(path);
      assert.deepEqual(Array.from(second), [1, 2, 3]);
    });
  });

  describe('directory operations', () => {
    it('creates nested directories recursively', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.mkdir('/deep/nested/path', { recursive: true });

      for (const path of ['/deep', '/deep/nested', '/deep/nested/path']) {
        const stats = await driver.stat(path);
        assert.ok(stats);
        assert.equal(stats.isDirectory, true);
        assert.equal(stats.isFile, false);
      }
    });

    it('requires an existing parent for non-recursive creation', async () => {
      const driver = new InMemoryStorageDriver();

      await assert.rejects(
        driver.mkdir('/missing/child'),
        (error: unknown) => errorCode(error) === 'ENOENT',
      );

      await driver.mkdir('/present');
      await driver.mkdir('/present/child');

      const stats = await driver.stat('/present/child');
      assert.ok(stats);
      assert.equal(stats.isDirectory, true);
    });

    it('rejects creating an existing directory twice', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.mkdir('/once');

      await assert.rejects(
        driver.mkdir('/once'),
        (error: unknown) => errorCode(error) === 'EEXIST',
      );

      await driver.mkdir('/once', { recursive: true });
    });

    it('lists direct children only', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.mkdir('/root/alpha', { recursive: true });
      await driver.writeFile('/root/beta.txt', 'beta');
      await driver.writeFile('/root/alpha/gamma.txt', 'gamma');

      const rootEntries = await driver.readDir('/root');
      assert.deepEqual(rootEntries, [
        { name: 'alpha', isFile: false, isDirectory: true },
        { name: 'beta.txt', isFile: true, isDirectory: false },
      ]);

      const alphaEntries = await driver.readDir('/root/alpha');
      assert.deepEqual(alphaEntries, [{ name: 'gamma.txt', isFile: true, isDirectory: false }]);
    });

    it('rejects reading a directory as a file', async () => {
      const driver = new InMemoryStorageDriver();

      await assert.rejects(
        driver.readFile('/'),
        (error: unknown) => errorCode(error) === 'EISDIR',
      );
    });
  });

  describe('rename', () => {
    it('replaces an existing target and removes the source', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.writeFile('/source.txt', 'source');
      await driver.writeFile('/target.txt', 'target');

      await driver.rename('/source.txt', '/target.txt');

      assert.equal(await driver.exists('/source.txt'), false);
      assert.equal(await driver.readText('/target.txt'), 'source');

      const entries = await driver.readDir('/');
      assert.deepEqual(entries, [{ name: 'target.txt', isFile: true, isDirectory: false }]);
    });

    it('moves a directory subtree atomically', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.mkdir('/src/child', { recursive: true });
      await driver.writeFile('/src/child/file.txt', 'payload');
      await driver.writeFile('/src/root.txt', 'root');

      await driver.rename('/src', '/dst');

      assert.equal(await driver.exists('/src'), false);
      assert.equal(await driver.readText('/dst/root.txt'), 'root');
      assert.equal(await driver.readText('/dst/child/file.txt'), 'payload');

      const stats = await driver.stat('/dst/child/file.txt');
      assert.ok(stats);
      assert.equal(stats.size, Buffer.byteLength('payload', 'utf8'));
    });

    it('rejects renaming a nonexistent source', async () => {
      const driver = new InMemoryStorageDriver();

      await assert.rejects(
        driver.rename('/missing.txt', '/target.txt'),
        (error: unknown) => errorCode(error) === 'ENOENT',
      );
    });
  });

  describe('deletion and negative lookups', () => {
    it('deletes a file and reports it as absent afterwards', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.writeFile('/ephemeral.txt', 'bye');
      await driver.deleteFile('/ephemeral.txt');

      assert.equal(await driver.exists('/ephemeral.txt'), false);
      assert.equal(await driver.stat('/ephemeral.txt'), null);

      await assert.rejects(
        driver.deleteFile('/ephemeral.txt'),
        (error: unknown) => errorCode(error) === 'ENOENT',
      );
    });

    it('returns null for a nonexistent path', async () => {
      const driver = new InMemoryStorageDriver();

      assert.equal(await driver.stat('/does/not/exist'), null);
      assert.equal(await driver.exists('/does/not/exist'), false);
    });

    it('returns the canonical key for realpath', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.mkdir('/workspace/notes', { recursive: true });
      await driver.writeFile('/workspace/notes/message.txt', 'hello');

      assert.equal(await driver.realpath('/workspace//notes/message.txt'), '/workspace/notes/message.txt');
      assert.equal(await driver.realpath('/workspace/notes/'), '/workspace/notes');
    });

    it('reports plain entries and missing paths through lstat', async () => {
      const driver = new InMemoryStorageDriver();

      await driver.mkdir('/workspace/notes', { recursive: true });
      await driver.writeFile('/workspace/notes/message.txt', 'hello');

      assert.deepEqual(await driver.lstat('/workspace/notes/message.txt'), {
        isSymbolicLink: false,
      });
      assert.deepEqual(await driver.lstat('/workspace/notes'), { isSymbolicLink: false });
      assert.equal(await driver.lstat('/workspace/missing.txt'), null);
    });

    it('rejects writes whose parent directory does not exist', async () => {
      const driver = new InMemoryStorageDriver();

      await assert.rejects(
        driver.writeFile('/missing/file.txt', 'data'),
        (error: unknown) => errorCode(error) === 'ENOENT',
      );
    });
  });
});
