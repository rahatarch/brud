import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { ATOMIC_TEMP_SUFFIX, writeAtomic } from './writeAtomic.js';

class RenameFailingDriver extends DurableNodeStorageDriver {
  override async rename(_sourcePath: string, _targetPath: string): Promise<void> {
    throw new Error('rename failed');
  }
}

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-write-atomic-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('writeAtomic operation', () => {
  it('writes a new file and removes the staging file', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'report.txt');

    await writeAtomic(driver, target, 'atomic payload');

    assert.equal(await driver.readText(target), 'atomic payload');
    assert.equal(await driver.exists(`${target}${ATOMIC_TEMP_SUFFIX}`), false);
  });

  it('replaces an existing file atomically', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'report.txt');
    await driver.writeFile(target, 'old payload');

    await writeAtomic(driver, target, 'new payload');

    assert.equal(await driver.readText(target), 'new payload');
    assert.equal(await driver.exists(`${target}${ATOMIC_TEMP_SUFFIX}`), false);
  });

  it('round-trips binary payloads', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'blob.bin');
    const payload = Uint8Array.from([0, 255, 1, 254, 128]);

    await writeAtomic(driver, target, payload);

    assert.deepEqual(Array.from(await driver.readFile(target)), Array.from(payload));
    assert.equal(await driver.readText(target, 'base64'), Buffer.from(payload).toString('base64'));
  });

  it('preserves the previous file and cleans the staging file when rename fails', async () => {
    const driver = new RenameFailingDriver();
    const target = join(root, 'report.txt');
    await driver.writeFile(target, 'original payload');

    await assert.rejects(
      writeAtomic(driver, target, 'replacement payload'),
      /rename failed/,
    );

    assert.equal(await driver.readText(target), 'original payload');
    assert.equal(await driver.exists(`${target}${ATOMIC_TEMP_SUFFIX}`), false);
  });
});