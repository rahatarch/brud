import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWorkspaceRootForPath, isWithinWorkspaceFolder } from './workspacePath';

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
