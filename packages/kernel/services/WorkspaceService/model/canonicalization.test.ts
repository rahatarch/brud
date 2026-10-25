import { posix } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalizationCache, canonicalizeNearestExisting } from './canonicalization.js';
import { MapPathPort, createIdentityPathPort } from '../testing/MapPathPort.js';

describe('canonicalizeNearestExisting', () => {
  it('resolves an existing path through realpath', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/notes': {}, '/ws/notes/a.md': {} });
    const outcome = await canonicalizeNearestExisting(port, posix, '/ws/notes/a.md');

    assert.deepEqual(outcome, {
      ok: true,
      canonical: '/ws/notes/a.md',
      existed: true,
      degraded: false,
    });
  });

  it('preserves non-existent descendants of the nearest existing ancestor', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/notes': {} });
    const outcome = await canonicalizeNearestExisting(port, posix, '/ws/notes/deep/new/file.txt');

    assert.deepEqual(outcome, {
      ok: true,
      canonical: '/ws/notes/deep/new/file.txt',
      existed: false,
      degraded: false,
    });
  });

  it('follows a symbolic link inside the root', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/real': {}, '/ws/link': { target: '/ws/real' } });
    const outcome = await canonicalizeNearestExisting(port, posix, '/ws/link/a.md');

    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok ? outcome.canonical : '', '/ws/real/a.md');
    assert.equal(outcome.ok ? outcome.existed : true, false);
  });

  it('reports a dangling symbolic link instead of guessing a target', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/dangling': { target: '/outside/missing' } });

    assert.deepEqual(
      await canonicalizeNearestExisting(port, posix, '/ws/dangling/file.txt'),
      { ok: false, reason: 'DANGLING_SYMLINK' },
    );
  });

  it('walks to the filesystem root when nothing exists', async () => {
    const port = createIdentityPathPort();
    const outcome = await canonicalizeNearestExisting(port, posix, '/nothing/here');

    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok ? outcome.canonical : '', '/nothing/here');
  });
});

describe('CanonicalizationCache', () => {
  it('memoizes existing paths and counts hits and misses', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/a.md': {} });
    const cache = new CanonicalizationCache();

    await cache.canonicalize(port, posix, '/ws/a.md');
    await cache.canonicalize(port, posix, '/ws/a.md');

    assert.equal(cache.misses, 1);
    assert.equal(cache.hits, 1);
    assert.equal(cache.size, 1);
  });

  it('never memoizes non-existent paths', async () => {
    const port = new MapPathPort({ '/ws': {} });
    const cache = new CanonicalizationCache();

    await cache.canonicalize(port, posix, '/ws/new/deep.txt');
    await cache.canonicalize(port, posix, '/ws/new/deep.txt');

    assert.equal(cache.misses, 2);
    assert.equal(cache.hits, 0);
    assert.equal(cache.size, 0);
  });

  it('does not memoize a dangling symlink failure', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/link': { target: '/outside/missing' } });
    const cache = new CanonicalizationCache();

    const first = await cache.canonicalize(port, posix, '/ws/link');
    const second = await cache.canonicalize(port, posix, '/ws/link');

    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(cache.size, 0);
  });

  it('clears entries but keeps counters', async () => {
    const port = new MapPathPort({ '/ws': {}, '/ws/a.md': {} });
    const cache = new CanonicalizationCache();

    await cache.canonicalize(port, posix, '/ws/a.md');
    cache.clear();
    await cache.canonicalize(port, posix, '/ws/a.md');

    assert.equal(cache.size, 1);
    assert.equal(cache.misses, 2);
  });
});
