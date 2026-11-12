import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../../drivers/DurableNodeStorageDriver.js';
import { statPath } from './statPath.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-stat-path-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('statPath operation', () => {
  it('reports file stats', async () => {
    const driver = new DurableNodeStorageDriver();
    const target = join(root, 'file.txt');
    await driver.writeFile(target, 'payload');

    const stats = await statPath(driver, target);

    assert.ok(stats);
    assert.equal(stats.isFile, true);
    assert.equal(stats.isDirectory, false);
    assert.equal(stats.size, Buffer.byteLength('payload', 'utf8'));
    assert.ok(stats.mtimeMs > 0);
  });

  it('reports directory stats', async () => {
    const driver = new DurableNodeStorageDriver();
    const directory = join(root, 'directory');
    await driver.mkdir(directory);

    const stats = await statPath(driver, directory);

    assert.ok(stats);
    assert.equal(stats.isFile, false);
    assert.equal(stats.isDirectory, true);
  });

  it('returns null for missing paths', async () => {
    const driver = new DurableNodeStorageDriver();

    assert.equal(await statPath(driver, join(root, 'missing')), null);
  });
});