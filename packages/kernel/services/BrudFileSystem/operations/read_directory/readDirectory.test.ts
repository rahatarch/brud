import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { readDirectory } from './readDirectory.js';

async function seed(driver: InMemoryStorageDriver): Promise<void> {
  await driver.mkdir('/workspace', { recursive: true });
}

describe('readDirectory operation', () => {
  it('lists direct child entries sorted by name', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.mkdir('/workspace/alpha', { recursive: true });
    await driver.writeFile('/workspace/beta.txt', 'beta');
    await driver.writeFile('/workspace/alpha/nested.txt', 'nested');

    const entries = await readDirectory(driver, '/workspace');

    assert.deepEqual(entries, [
      { name: 'alpha', isFile: false, isDirectory: true },
      { name: 'beta.txt', isFile: true, isDirectory: false },
    ]);
  });

  it('returns an empty list for an empty directory', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.mkdir('/workspace/empty');

    assert.deepEqual(await readDirectory(driver, '/workspace/empty'), []);
  });

  it('propagates missing directory errors', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    await assert.rejects(readDirectory(driver, '/workspace/missing'), /ENOENT/);
  });
});
