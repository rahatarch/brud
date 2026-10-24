import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { statPath } from './statPath.js';

async function seed(driver: InMemoryStorageDriver): Promise<void> {
  await driver.mkdir('/workspace', { recursive: true });
}

describe('statPath operation', () => {
  it('reports file stats', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/file.txt', 'payload');

    const stats = await statPath(driver, '/workspace/file.txt');

    assert.ok(stats);
    assert.equal(stats.isFile, true);
    assert.equal(stats.isDirectory, false);
    assert.equal(stats.size, Buffer.byteLength('payload', 'utf8'));
    assert.ok(stats.mtimeMs > 0);
  });

  it('reports directory stats', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.mkdir('/workspace/directory');

    const stats = await statPath(driver, '/workspace/directory');

    assert.ok(stats);
    assert.equal(stats.isFile, false);
    assert.equal(stats.isDirectory, true);
  });

  it('returns null for missing paths', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    assert.equal(await statPath(driver, '/workspace/missing'), null);
  });
});
