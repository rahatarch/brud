import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { hasErrorCode } from '../shared/errors.js';
import { deleteFile } from './deleteFile.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-delete-file-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('deleteFile operation', () => {
  it('removes an existing file', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'payload');

    await deleteFile(driver, target);

    assert.equal(await driver.exists(target), false);
  });

  it('is idempotent for missing files', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'missing.txt');

    await deleteFile(driver, target);
    await deleteFile(driver, target);

    assert.equal(await driver.exists(target), false);
  });

  it('propagates errors other than ENOENT', async () => {
    const driver = new DurableNodeStorageDriver();
    const directory = join(root, 'directory');
    await driver.mkdir(directory);

    await assert.rejects(
      deleteFile(driver, directory),
      (error: unknown) => !hasErrorCode(error, 'ENOENT'),
    );
  });
});