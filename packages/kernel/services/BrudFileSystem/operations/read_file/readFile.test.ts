import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { readFile, readText } from './readFile.js';

async function seed(driver: InMemoryStorageDriver): Promise<void> {
  await driver.mkdir('/workspace', { recursive: true });
}

describe('readFile operation', () => {
  it('reads bytes and text from the storage driver', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/message.txt', 'hello workspace');

    const bytes = await readFile(driver, '/workspace/message.txt');
    assert.deepEqual(Array.from(bytes), Array.from(Buffer.from('hello workspace', 'utf8')));
    assert.equal(await readText(driver, '/workspace/message.txt'), 'hello workspace');
  });

  it('honours an explicit encoding', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/message.txt', 'hello');

    assert.equal(
      await readText(driver, '/workspace/message.txt', 'base64'),
      Buffer.from('hello').toString('base64'),
    );
  });

  it('propagates missing file errors', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    await assert.rejects(readFile(driver, '/workspace/missing.txt'), /ENOENT/);
  });
});
