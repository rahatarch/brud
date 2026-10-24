import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { hasErrorCode } from '../shared/errors.js';
import { deleteFile } from './deleteFile.js';

async function seed(driver: InMemoryStorageDriver): Promise<void> {
  await driver.mkdir('/workspace', { recursive: true });
}

describe('deleteFile operation', () => {
  it('removes an existing file', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/file.txt', 'payload');

    await deleteFile(driver, '/workspace/file.txt');

    assert.equal(await driver.exists('/workspace/file.txt'), false);
  });

  it('is idempotent for missing files', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    await deleteFile(driver, '/workspace/missing.txt');
    await deleteFile(driver, '/workspace/missing.txt');

    assert.equal(await driver.exists('/workspace/missing.txt'), false);
  });

  it('propagates errors other than ENOENT', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.mkdir('/workspace/directory');

    await assert.rejects(
      deleteFile(driver, '/workspace/directory'),
      (error: unknown) => !hasErrorCode(error, 'ENOENT'),
    );
  });
});
