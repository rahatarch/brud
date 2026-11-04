import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { readDirectory } from './readDirectory.js';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-read-directory-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readDirectory operation', () => {
  it('lists direct child entries sorted by name', async () => {
    const driver = new DurableNodeStorageDriver();
    await driver.mkdir(join(root, 'alpha'), { recursive: true });
    await driver.writeFile(join(root, 'beta.txt'), 'beta');
    await driver.writeFile(join(root, 'alpha/nested.txt'), 'nested');

    const entries = await readDirectory(driver, root);

    assert.deepEqual(
      [...entries].sort((left, right) => left.name.localeCompare(right.name)),
      [
        { name: 'alpha', isFile: false, isDirectory: true },
        { name: 'beta.txt', isFile: true, isDirectory: false },
      ],
    );
  });

  it('returns an empty list for an empty directory', async () => {
    const driver = new DurableNodeStorageDriver();
    await driver.mkdir(join(root, 'empty'));

    assert.deepEqual(await readDirectory(driver, join(root, 'empty')), []);
  });

  it('propagates missing directory errors', async () => {
    const driver = new DurableNodeStorageDriver();

    await assert.rejects(readDirectory(driver, join(root, 'missing')), /ENOENT/);
  });
});