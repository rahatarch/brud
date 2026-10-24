import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { FileAlreadyExistsError } from '../shared/errors.js';
import { createFile } from './createFile.js';

async function seed(driver: InMemoryStorageDriver): Promise<void> {
  await driver.mkdir('/workspace', { recursive: true });
}

describe('createFile operation', () => {
  it('creates parent directories recursively', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    await createFile(driver, '/workspace/deep/nested/file.txt', 'payload');

    assert.equal(await driver.readText('/workspace/deep/nested/file.txt'), 'payload');
    const stats = await driver.stat('/workspace/deep/nested');
    assert.ok(stats);
    assert.equal(stats.isDirectory, true);
  });

  it('writes binary payloads', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    const payload = Uint8Array.from([7, 0, 9, 255]);

    await createFile(driver, '/workspace/blob.bin', payload);

    assert.deepEqual(Array.from(await driver.readFile('/workspace/blob.bin')), Array.from(payload));
  });

  it('overwrites existing files by default', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/file.txt', 'original');

    await createFile(driver, '/workspace/file.txt', 'replacement');

    assert.equal(await driver.readText('/workspace/file.txt'), 'replacement');
  });

  it('replaces existing files when overwrite is true', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/file.txt', 'original');

    await createFile(driver, '/workspace/file.txt', 'replacement', { overwrite: true });

    assert.equal(await driver.readText('/workspace/file.txt'), 'replacement');
  });

  it('refuses to overwrite when overwrite is false', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/file.txt', 'original');

    await assert.rejects(
      createFile(driver, '/workspace/file.txt', 'replacement', { overwrite: false }),
      (error: unknown) =>
        error instanceof FileAlreadyExistsError
        && error.code === 'FILE_ALREADY_EXISTS'
        && error.path === '/workspace/file.txt',
    );

    assert.equal(await driver.readText('/workspace/file.txt'), 'original');
  });

  it('creates a missing file when overwrite is false', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    await createFile(driver, '/workspace/file.txt', 'fresh', { overwrite: false });

    assert.equal(await driver.readText('/workspace/file.txt'), 'fresh');
  });
});
