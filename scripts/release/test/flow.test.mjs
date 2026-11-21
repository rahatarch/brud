// End-to-end test of the local release steps against a throwaway git repo.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, args, cwd, env = {}) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, shell: process.platform === 'win32' && cmd === 'npm' });
const git = (cwd, ...args) => {
  const r = sh('git', args, cwd);
  assert.equal(r.status, 0, `git ${args.join(' ')}\n${r.stderr}`);
  return r.stdout.trim();
};
const script = (name, cwd, args) =>
  sh('node', [join(scripts, name), ...args], cwd, { BRUD_RELEASE_ROOT: cwd, npm_config_audit: 'false', npm_config_fund: 'false' });

const NOTES = `# BrudOS 0.0.2

## Summary
A small patch release used by the release flow test.

## Changes
### Fixed
- **kernel:** Fixed a thing. (#1)
`;

function setup() {
  const { root, write } = makeRepo('0.0.1');
  const remote = mkdtempSync(join(tmpdir(), 'brud-remote-'));
  mkdirSync(remote, { recursive: true });
  git(remote, 'init', '--bare', '-b', 'main');
  // Let real npm write the lockfile, as it would in the real repo.
  const lock = sh('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], root);
  assert.equal(lock.status, 0, lock.stderr);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.test');
  git(root, 'config', 'user.name', 'Test');
  write('docs/release-notes/v0.0.2.md', NOTES);
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'initial');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  return { root, remote, write };
}

test('prepare then tag: bumps everything, commits, creates an annotated tag, pushes it', () => {
  const { root, remote } = setup();

  const dry = script('prepare.mjs', root, ['0.0.2', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(git(root, 'status', '--porcelain'), '');

  const prep = script('prepare.mjs', root, ['0.0.2']);
  assert.equal(prep.status, 0, `${prep.stdout}\n${prep.stderr}`);
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'release: v0.0.2');
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/kernel/package.json'), 'utf8')).version, '0.0.2');
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/daemon/package.json'), 'utf8')).dependencies['@brud/kernel'], '^0.0.2');
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/services/settings/package.json'), 'utf8')).dependencies['@brud/kernel'], '*');
  assert.match(readFileSync(join(root, 'packages/sdk/src/core/contract.ts'), 'utf8'), /SDK_VERSION = '0\.0\.2'/);

  // Not pushed yet: tagging must refuse until HEAD equals origin/main.
  const early = script('tag.mjs', root, ['0.0.2']);
  assert.notEqual(early.status, 0);
  assert.match(early.stderr, /origin\/main/);

  git(root, 'push', 'origin', 'main');
  const tagged = script('tag.mjs', root, ['0.0.2', '--push']);
  assert.equal(tagged.status, 0, `${tagged.stdout}\n${tagged.stderr}`);
  assert.equal(git(root, 'cat-file', '-t', 'refs/tags/v0.0.2'), 'tag'); // annotated
  assert.equal(git(remote, 'tag', '--list', 'v0.0.2'), 'v0.0.2');

  const again = script('tag.mjs', root, ['0.0.2']);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
});

test('prepare refuses: missing notes, a lower version, a dirty tree', () => {
  const { root, write } = setup();
  assert.match(script('prepare.mjs', root, ['0.0.3']).stderr, /release notes first/);
  assert.match(script('prepare.mjs', root, ['0.0.1']).stderr, /must be greater/);
  assert.match(script('prepare.mjs', root, ['not-a-version']).stderr, /not a valid version/);
  write('stray.txt', 'x');
  assert.match(script('prepare.mjs', root, ['0.0.2']).stderr, /uncommitted changes/);
});

test('a failed bump leaves the tree untouched', () => {
  const { root, write } = setup();
  // A core package with a non-caret internal range cannot be bumped consistently.
  write('packages/daemon/package.json', {
    name: '@brud/daemon', version: '0.0.1', license: 'Apache-2.0', repository: 'r', engines: { node: '>=22' },
    publishConfig: { access: 'public' }, dependencies: { '@brud/kernel': '>=0.0.1', '@brud/protocol': '^0.0.1' },
  });
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'odd range');
  git(root, 'push', 'origin', 'main');
  const prep = script('prepare.mjs', root, ['0.0.2']);
  assert.notEqual(prep.status, 0);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(JSON.parse(readFileSync(join(root, 'packages/kernel/package.json'), 'utf8')).version, '0.0.1');
});
