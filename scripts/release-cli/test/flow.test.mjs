// End-to-end test of the local CLI release steps against a throwaway git repo.
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
  sh('node', [join(scripts, name), ...args], cwd, { BRUD_CLI_RELEASE_ROOT: cwd, npm_config_audit: 'false', npm_config_fund: 'false' });

const NOTES = `# Brud CLI 0.0.2

## Summary
A small patch release used by the release flow test.

## Changes
### Fixed
- **cli:** Fixed a thing. (#1)
`;

function setup() {
  const { root, write } = makeRepo('0.0.1');
  const remote = mkdtempSync(join(tmpdir(), 'brud-cli-remote-'));
  mkdirSync(remote, { recursive: true });
  git(remote, 'init', '--bare', '-b', 'main');
  const lock = sh('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], root);
  assert.equal(lock.status, 0, lock.stderr);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.test');
  git(root, 'config', 'user.name', 'Test');
  write('docs/release-notes/cli-v0.0.2.md', NOTES);
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'initial');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  return { root, remote, write };
}

test('prepare then tag: bumps the CLI, commits, creates an annotated cli-v tag, pushes it', () => {
  const { root, remote } = setup();
  const dry = script('prepare.mjs', root, ['0.0.2', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(git(root, 'status', '--porcelain'), '');

  const prep = script('prepare.mjs', root, ['0.0.2']);
  assert.equal(prep.status, 0, `${prep.stdout}\n${prep.stderr}`);
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'release(cli): cli-v0.0.2');
  const manifest = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
  assert.equal(manifest.version, '0.0.2');
  assert.equal(manifest.peerDependencies['@brud/kernel'], '^0.0.1'); // peer ranges are not touched by a CLI release
  assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages['packages/cli'].version, '0.0.2');

  const early = script('tag.mjs', root, ['0.0.2']);
  assert.notEqual(early.status, 0);
  assert.match(early.stderr, /origin\/main/);

  git(root, 'push', 'origin', 'main');
  const tagged = script('tag.mjs', root, ['0.0.2', '--push']);
  assert.equal(tagged.status, 0, `${tagged.stdout}\n${tagged.stderr}`);
  assert.equal(git(root, 'cat-file', '-t', 'refs/tags/cli-v0.0.2'), 'tag');
  assert.equal(git(remote, 'tag', '--list', 'cli-v0.0.2'), 'cli-v0.0.2');
  assert.equal(git(remote, 'tag', '--list', 'v*'), ''); // never a BrudOS-style tag

  const again = script('tag.mjs', root, ['0.0.2']);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
});

test('prepare refuses: missing notes, a lower version, a bad version, a dirty tree', () => {
  const { root, write } = setup();
  assert.match(script('prepare.mjs', root, ['0.0.3']).stderr, /release notes first/);
  assert.match(script('prepare.mjs', root, ['0.0.1']).stderr, /must be greater/);
  assert.match(script('prepare.mjs', root, ['not-a-version']).stderr, /not a valid version/);
  write('stray.txt', 'x');
  assert.match(script('prepare.mjs', root, ['0.0.2']).stderr, /uncommitted changes/);
});
