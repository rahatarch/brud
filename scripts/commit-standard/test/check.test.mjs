import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { checkMessage } from '../lib.mjs';

const CHECK = resolve(import.meta.dirname, '..', 'check.mjs');
const HOOK = resolve(import.meta.dirname, '..', '..', '..', '.githooks', 'commit-msg');
const ok = (message) => assert.deepEqual(checkMessage(message), [], message);
const bad = (message, pattern) => assert.match(checkMessage(message).join('\n'), pattern, message);

test('accepts well-formed subjects, with and without a scope', () => {
  ok('feat(kernel): explain a refused resolve');
  ok('fix: stop dropping the last parameter');
  ok('docs(cli): update the install guide\n');
  ok('ci(release-participant): add a tag-driven pipeline');
  ok('test(kernel): pin kind handler identity');
});

test('accepts a structured body', () => {
  ok('feat(kernel): add lastRefusal()\n\nWhat is new\n-----------\n- a thing\n\nTests added\n-----------\n- a test\n');
});

test('rejects a wrong or missing type, a missing space, and an empty summary', () => {
  bad('added a feature', /subject must be/);
  bad('feature(kernel): x', /subject must be/);
  bad('feat(kernel):nospace', /subject must be/);
  bad('feat(kernel): ', /subject must be/);
  bad('Feat(kernel): x', /subject must be/);
  bad('feat(Kernel): x', /subject must be/);
});

test('rejects a long subject, a trailing period, and a missing blank line', () => {
  bad(`feat(kernel): ${'x'.repeat(70)}`, /limit is 72/);
  bad('fix(kernel): stop the crash.', /period/);
  bad('fix(kernel): stop the crash\nthe body starts too soon', /must be blank/);
});

test('rejects an empty message', () => {
  bad('', /empty/);
  bad('\n\n# only comments\n', /empty/);
});

test('ignores comment lines git adds to the message', () => {
  ok('fix(kernel): stop the crash\n\n# Please enter the commit message\n# Changes to be committed:');
});

test('a breaking subject needs a BREAKING CHANGE line', () => {
  bad('feat(kernel)!: drop the old shape', /BREAKING CHANGE/);
  ok('feat(kernel)!: drop the old shape\n\nBREAKING CHANGE: callers must read lastRefusal() instead');
});

test('rejects AI attribution lines in any form', () => {
  for (const line of [
    'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>',
    'co-authored-by: ChatGPT <bot@openai.com>',
    'Co-authored-by: GitHub Copilot <copilot@github.com>',
    '\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)',
    'Session: https://claude.ai/code/session_abc123',
  ]) {
    bad(`fix(kernel): stop the crash\n\nbody\n\n${line}`, /AI attribution/);
  }
});

test('allows a human co-author', () => {
  ok('fix(kernel): stop the crash\n\nCo-authored-by: Ada Lovelace <ada@example.com>');
});

test('lets git-generated messages through but still refuses attribution in them', () => {
  ok('Merge branch \'main\' into feature');
  ok('Revert "feat(kernel): add lastRefusal()"\n\nThis reverts commit abc123.');
  ok('fixup! feat(kernel): add lastRefusal()');
  bad('Merge branch x\n\nCo-Authored-By: Claude <noreply@anthropic.com>', /AI attribution/);
});

function run(args, cwd) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', cwd });
}

test('the file mode exits 0 for a good message and 1 for a bad one, naming the problem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-commit-standard-'));

  try {
    const file = join(dir, 'MSG');

    writeFileSync(file, 'feat(kernel): good');
    assert.equal(run(['--file', file]).status, 0);

    writeFileSync(file, 'bad message');
    const result = run(['--file', file]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /subject must be/);
    assert.equal(run([]).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the range mode checks every non-merge commit and reports each bad one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-commit-standard-range-'));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });

  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a'), '1');
    git('add', '.');
    git('commit', '-q', '-m', 'old history that predates the standard');
    const base = git('rev-parse', 'HEAD').stdout.trim();

    writeFileSync(join(dir, 'a'), '2');
    git('commit', '-q', '-am', 'feat(kernel): a good commit');
    writeFileSync(join(dir, 'a'), '3');
    git('commit', '-q', '-am', 'sloppy message');
    writeFileSync(join(dir, 'a'), '4');
    git('commit', '-q', '-am', 'fix(kernel): stop it', '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>');

    const result = run(['--range', `${base}..HEAD`], dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /subject must be/);
    assert.match(result.stderr, /AI attribution/);
    assert.equal((result.stderr.match(/subject must be/g) ?? []).length, 1, 'the old commit and the good one are not reported');
    assert.equal(run(['--range', `${base}..${base}`], dir).status, 0);
    assert.equal(run(['--range', 'nope..nothing'], dir).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real commit-msg hook blocks a bad commit and allows a good one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-commit-standard-hook-'));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });

  try {
    git('init', '-q', '-b', 'main');
    git('config', 'core.hooksPath', resolve(HOOK, '..'));
    writeFileSync(join(dir, 'a'), '1');
    git('add', '.');

    assert.notEqual(git('commit', '-q', '-m', 'sloppy message').status, 0);
    assert.equal(git('commit', '-q', '-m', 'feat(kernel): a good commit').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
