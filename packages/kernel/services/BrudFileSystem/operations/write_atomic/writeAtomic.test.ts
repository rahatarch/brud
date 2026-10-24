import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { ATOMIC_TEMP_SUFFIX, writeAtomic } from './writeAtomic.js';

class RenameFailingDriver extends InMemoryStorageDriver {
  override async rename(_sourcePath: string, _targetPath: string): Promise<void> {
    throw new Error('rename failed');
  }
}

async function seed(driver: InMemoryStorageDriver): Promise<void> {
  await driver.mkdir('/workspace', { recursive: true });
}

describe('writeAtomic operation', () => {
  it('writes a new file and removes the staging file', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);

    await writeAtomic(driver, '/workspace/report.txt', 'atomic payload');

    assert.equal(await driver.readText('/workspace/report.txt'), 'atomic payload');
    assert.equal(await driver.exists(`/workspace/report.txt${ATOMIC_TEMP_SUFFIX}`), false);
  });

  it('replaces an existing file atomically', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    await driver.writeFile('/workspace/report.txt', 'old payload');

    await writeAtomic(driver, '/workspace/report.txt', 'new payload');

    assert.equal(await driver.readText('/workspace/report.txt'), 'new payload');
    assert.equal(await driver.exists(`/workspace/report.txt${ATOMIC_TEMP_SUFFIX}`), false);
  });

  it('round-trips binary payloads', async () => {
    const driver = new InMemoryStorageDriver();
    await seed(driver);
    const payload = Uint8Array.from([0, 255, 1, 254, 128]);

    await writeAtomic(driver, '/workspace/blob.bin', payload);

    assert.deepEqual(Array.from(await driver.readFile('/workspace/blob.bin')), Array.from(payload));
    assert.equal(await driver.readText('/workspace/blob.bin', 'base64'), Buffer.from(payload).toString('base64'));
  });

  it('preserves the previous file and cleans the staging file when rename fails', async () => {
    const driver = new RenameFailingDriver();
    await seed(driver);
    await driver.writeFile('/workspace/report.txt', 'original payload');

    await assert.rejects(
      writeAtomic(driver, '/workspace/report.txt', 'replacement payload'),
      /rename failed/,
    );

    assert.equal(await driver.readText('/workspace/report.txt'), 'original payload');
    assert.equal(await driver.exists(`/workspace/report.txt${ATOMIC_TEMP_SUFFIX}`), false);
  });
});
