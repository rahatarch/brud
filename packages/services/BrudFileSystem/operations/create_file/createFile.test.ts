import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { FileAlreadyExistsError } from '../shared/errors.js';
import { createFile } from './createFile.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-create-file-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createFile operation', () => {
  it('creates parent directories recursively', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'deep/nested/file.txt');

    await createFile(driver, target, 'payload');

    assert.equal(await driver.readText(target), 'payload');
    const stats = await driver.stat(join(root, 'deep/nested'));
    assert.ok(stats);
    assert.equal(stats.isDirectory, true);
  });

  it('writes binary payloads', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'blob.bin');
    const payload = Uint8Array.from([7, 0, 9, 255]);

    await createFile(driver, target, payload);

    assert.deepEqual(Array.from(await driver.readFile(target)), Array.from(payload));
  });

  it('overwrites existing files by default', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'original');

    await createFile(driver, target, 'replacement');

    assert.equal(await driver.readText(target), 'replacement');
  });

  it('replaces existing files when overwrite is true', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'original');

    await createFile(driver, target, 'replacement', { overwrite: true });

    assert.equal(await driver.readText(target), 'replacement');
  });

  it('refuses to overwrite when overwrite is false', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'original');

    await assert.rejects(
      createFile(driver, target, 'replacement', { overwrite: false }),
      (error: unknown) =>
        error instanceof FileAlreadyExistsError
        && error.code === 'FILE_ALREADY_EXISTS'
        && error.path === target,
    );

    assert.equal(await driver.readText(target), 'original');
  });

  it('creates a missing file when overwrite is false', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');

    await createFile(driver, target, 'fresh', { overwrite: false });

    assert.equal(await driver.readText(target), 'fresh');
  });
});