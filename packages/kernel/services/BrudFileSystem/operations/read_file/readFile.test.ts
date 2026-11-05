import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { readFile, readText } from './readFile.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-read-file-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readFile operation', () => {
  it('reads bytes and text from the storage driver', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'message.txt');
    await driver.writeFile(target, 'hello workspace');

    const bytes = await readFile(driver, target);
    assert.deepEqual(Array.from(bytes), Array.from(Buffer.from('hello workspace', 'utf8')));
    assert.equal(await readText(driver, target), 'hello workspace');
  });

  it('honours an explicit encoding', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'message.txt');
    await driver.writeFile(target, 'hello');

    assert.equal(
      await readText(driver, target, 'base64'),
      Buffer.from('hello').toString('base64'),
    );
  });

  it('propagates missing file errors', async () => {
    const driver = new DurableNodeStorageDriver();

    await assert.rejects(readFile(driver, join(root, 'missing.txt')), /ENOENT/);
  });
});