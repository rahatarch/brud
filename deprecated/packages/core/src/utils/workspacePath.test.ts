import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createPathCache,
  getWorkspaceRootForPath,
  isWithinWorkspaceFolder,
  validateWorkspacePath,
  validateWorkspacePathWithCode,
} from './workspacePath';

describe('workspace containment', () => {
  let base: string;
  let root: string;
  let outside: string;

  before(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'brud-contain-'));
    root = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(root, 'inside.txt'), 'inside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('accepts a path inside the workspace', () => {
    assert.strictEqual(isWithinWorkspaceFolder(path.join(root, 'inside.txt'), root), true);
    assert.strictEqual(getWorkspaceRootForPath('inside.txt', [root]), root);
  });

  it('rejects a path outside the workspace', () => {
    assert.strictEqual(isWithinWorkspaceFolder(path.join(outside, 'secret.txt'), root), false);
    assert.strictEqual(getWorkspaceRootForPath(path.join(outside, 'secret.txt'), [root]), null);
  });

  it('rejects a sibling directory sharing the workspace name prefix', () => {
    const sibling = `${root}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    assert.strictEqual(isWithinWorkspaceFolder(path.join(sibling, 'x.txt'), root), false);
    assert.strictEqual(getWorkspaceRootForPath(path.join(sibling, 'x.txt'), [root]), null);
  });

  it('rejects escape through a symbolic link inside the workspace', () => {
    const link = path.join(root, 'escape');
    fs.symlinkSync(outside, link, 'dir');
    assert.strictEqual(isWithinWorkspaceFolder(path.join(link, 'secret.txt'), root), false);
    assert.strictEqual(getWorkspaceRootForPath(path.join(link, 'secret.txt'), [root]), null);
    assert.strictEqual(getWorkspaceRootForPath('escape/secret.txt', [root]), null);
  });

  it('accepts a symbolic link that stays inside the workspace', () => {
    const target = path.join(root, 'nested');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'ok.txt'), 'ok');
    const link = path.join(root, 'inner-link');
    fs.symlinkSync(target, link, 'dir');
    assert.strictEqual(isWithinWorkspaceFolder(path.join(link, 'ok.txt'), root), true);
  });

  it('accepts paths that do not exist yet but sit inside the workspace', () => {
    const future = path.join(root, 'new', 'deep', 'file.txt');
    assert.strictEqual(isWithinWorkspaceFolder(future, root), true);
    assert.strictEqual(getWorkspaceRootForPath(future, [root]), root);
  });

  it('treats the workspace root itself as inside', () => {
    assert.strictEqual(isWithinWorkspaceFolder(root, root), true);
  });
});

describe('PathCache', () => {
  let base: string;
  let root: string;
  let outside: string;
  let insideFile: string;
  let outsideFile: string;

  before(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'brud-pathcache-'));
    root = path.join(base, 'workspace');
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    insideFile = path.join(root, 'src', 'a.ts');
    outsideFile = path.join(outside, 'secret.txt');
    fs.writeFileSync(insideFile, 'export const a = 1;\n');
    fs.writeFileSync(outsideFile, 'secret');
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('starts with zero hits and misses', () => {
    const cache = createPathCache();
    assert.strictEqual(cache.hits, 0);
    assert.strictEqual(cache.misses, 0);
  });

  it('counts a miss on the first canonicalize and hits afterwards', () => {
    const cache = createPathCache();
    const first = cache.canonicalize(insideFile);
    assert.strictEqual(cache.misses, 1);
    assert.strictEqual(cache.hits, 0);

    const second = cache.canonicalize(insideFile);
    assert.strictEqual(cache.hits, 1);
    assert.strictEqual(cache.misses, 1);
    assert.strictEqual(first, second);
    assert.strictEqual(first, fs.realpathSync.native(insideFile));
  });

  it('does not memoize canonicalizations for paths that do not exist (D-1)', () => {
    const cache = createPathCache();
    const future = path.join(root, 'not', 'created', 'yet.txt');
    const first = cache.canonicalize(future);
    const second = cache.canonicalize(future);

    assert.strictEqual(first, second);
    assert.strictEqual(cache.hits, 0);
    assert.strictEqual(cache.misses, 2);
  });

  it('counts a miss then a hit for repeated containment checks and matches the uncached result', () => {
    const cache = createPathCache();
    const first = cache.isWithin(insideFile, root);
    assert.strictEqual(first, true);
    assert.strictEqual(cache.misses, 1);
    assert.strictEqual(cache.hits, 0);

    const second = cache.isWithin(insideFile, root);
    assert.strictEqual(second, true);
    assert.strictEqual(cache.hits, 1);
    assert.strictEqual(cache.misses, 1);
    assert.strictEqual(second, isWithinWorkspaceFolder(insideFile, root));

    assert.strictEqual(cache.isWithin(outsideFile, root), false);
    assert.strictEqual(cache.isWithin(outsideFile, root), isWithinWorkspaceFolder(outsideFile, root));
  });

  it('preserves getWorkspaceRootForPath results while populating the cache', () => {
    const cache = createPathCache();
    assert.strictEqual(getWorkspaceRootForPath('src/a.ts', [root], cache), root);
    assert.strictEqual(getWorkspaceRootForPath(path.join(root, 'src', 'a.ts'), [root], cache), root);
    assert.strictEqual(getWorkspaceRootForPath(path.join(outside, 'secret.txt'), [root], cache), null);

    assert.ok(cache.hits + cache.misses > 0);
    assert.ok(cache.hits > 0);
    assert.strictEqual(getWorkspaceRootForPath('src/a.ts', [root], cache), getWorkspaceRootForPath('src/a.ts', [root]));
  });

  it('validateWorkspacePath returns identical values with and without a cache', () => {
    const cache = createPathCache();

    const cachedInside = validateWorkspacePath('src/a.ts', [root], cache);
    const plainInside = validateWorkspacePath('src/a.ts', [root]);
    assert.deepStrictEqual(cachedInside, plainInside);
    assert.strictEqual(cachedInside.valid, true);

    const cachedOutside = validateWorkspacePath(path.join(outside, 'secret.txt'), [root], cache);
    const plainOutside = validateWorkspacePath(path.join(outside, 'secret.txt'), [root]);
    assert.deepStrictEqual(cachedOutside, plainOutside);
    assert.strictEqual(cachedOutside.valid, false);

    assert.ok(cache.hits + cache.misses >= 2);
  });

  it('reuses one canonicalization of the workspace root across a batch', () => {
    const cache = createPathCache();
    for (let i = 0; i < 5; i++) {
      validateWorkspacePath(`src/file-${i}.ts`, [root], cache);
    }

    const hitsBefore = cache.hits;
    assert.strictEqual(cache.canonicalize(root), fs.realpathSync.native(root));
    assert.strictEqual(cache.hits, hitsBefore + 1);
    assert.ok(cache.misses >= 5);
  });

  it('validateWorkspacePathWithCode forwards the cache and matches the uncached result', () => {
    const cache = createPathCache();
    const cached = validateWorkspacePathWithCode('src/a.ts', [root], cache);
    const plain = validateWorkspacePathWithCode('src/a.ts', [root]);

    assert.strictEqual(cached.success, plain.success);
    assert.strictEqual(cached.success, true);
    assert.ok(cache.hits + cache.misses > 0);
  });
});
