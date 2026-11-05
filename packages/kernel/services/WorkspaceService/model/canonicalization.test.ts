import { posix } from 'node:path';
import { after, before, beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import { CanonicalizationCache, canonicalizeNearestExisting } from './canonicalization.js';

let base = '';
let root = '';

before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'brud-canonicalization-')));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(base, 'case-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function realPort(): ReturnType<typeof createStorageDriverPathPort> {
  return createStorageDriverPathPort(new NodeStorageDriver());
}

describe('canonicalizeNearestExisting', () => {
  it('resolves an existing path through realpath', async () => {
    const port = realPort();
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes/a.md'), 'a');

    const outcome = await canonicalizeNearestExisting(port, posix, join(root, 'notes/a.md'));

    assert.deepEqual(outcome, {
      ok: true,
      canonical: join(root, 'notes/a.md'),
      existed: true,
      degraded: false,
    });
  });

  it('preserves non-existent descendants of the nearest existing ancestor', async () => {
    const port = realPort();
    await mkdir(join(root, 'notes'));

    const outcome = await canonicalizeNearestExisting(port, posix, join(root, 'notes/deep/new/file.txt'));

    assert.deepEqual(outcome, {
      ok: true,
      canonical: join(root, 'notes/deep/new/file.txt'),
      existed: false,
      degraded: false,
    });
  });

  it('follows a symbolic link inside the root', async () => {
    const port = realPort();
    await mkdir(join(root, 'real'));
    await symlink(join(root, 'real'), join(root, 'link'));

    const outcome = await canonicalizeNearestExisting(port, posix, join(root, 'link/a.md'));

    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok ? outcome.canonical : '', join(root, 'real/a.md'));
    assert.equal(outcome.ok ? outcome.existed : true, false);
  });

  it('reports a dangling symbolic link instead of guessing a target', async () => {
    const port = realPort();
    await symlink(join(base, 'missing-target'), join(root, 'dangling'));

    assert.deepEqual(
      await canonicalizeNearestExisting(port, posix, join(root, 'dangling/file.txt')),
      { ok: false, reason: 'DANGLING_SYMLINK' },
    );
  });

  it('walks to the filesystem root when nothing exists', async () => {
    const port = realPort();
    const outcome = await canonicalizeNearestExisting(port, posix, '/nothing/here');

    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok ? outcome.canonical : '', '/nothing/here');
  });
});

describe('CanonicalizationCache', () => {
  it('memoizes existing paths and counts hits and misses', async () => {
    const port = realPort();
    await writeFile(join(root, 'a.md'), 'a');
    const cache = new CanonicalizationCache();

    await cache.canonicalize(port, posix, join(root, 'a.md'));
    await cache.canonicalize(port, posix, join(root, 'a.md'));

    assert.equal(cache.misses, 1);
    assert.equal(cache.hits, 1);
    assert.equal(cache.size, 1);
  });

  it('never memoizes non-existent paths', async () => {
    const port = realPort();
    const cache = new CanonicalizationCache();

    await cache.canonicalize(port, posix, join(root, 'new/deep.txt'));
    await cache.canonicalize(port, posix, join(root, 'new/deep.txt'));

    assert.equal(cache.misses, 2);
    assert.equal(cache.hits, 0);
    assert.equal(cache.size, 0);
  });

  it('does not memoize a dangling symlink failure', async () => {
    const port = realPort();
    await symlink(join(base, 'missing-target'), join(root, 'link'));
    const cache = new CanonicalizationCache();

    const first = await cache.canonicalize(port, posix, join(root, 'link'));
    const second = await cache.canonicalize(port, posix, join(root, 'link'));

    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(cache.size, 0);
  });

  it('clears entries but keeps counters', async () => {
    const port = realPort();
    await writeFile(join(root, 'a.md'), 'a');
    const cache = new CanonicalizationCache();

    await cache.canonicalize(port, posix, join(root, 'a.md'));
    cache.clear();
    await cache.canonicalize(port, posix, join(root, 'a.md'));

    assert.equal(cache.size, 1);
    assert.equal(cache.misses, 2);
  });
});