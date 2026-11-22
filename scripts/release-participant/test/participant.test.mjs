import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { RESERVED, buildBody, checkNotes, checkParticipant, listPackages, parseTag, participants, tagFor } from '../lib/participant.mjs';
import { parseArgs } from '../lib/args.mjs';

/** A throwaway repo with one participant under packages/services/<Dir>. */
function makeRepo(version = '0.1.0', override = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brud-participant-release-test-'));
  const write = (rel, content) => {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  };
  const manifest = {
    name: '@brud/settings', version, license: 'Apache-2.0', main: 'dist/index.js', files: ['dist'],
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' }, engines: { node: '>=22' },
    publishConfig: { access: 'public' }, brud: { role: 'participant' },
    peerDependencies: { '@brud/kernel': '^0.0.1' },
    ...override,
  };
  write('package.json', { name: 'root', private: true, workspaces: ['packages/*', 'packages/services/*'] });
  write('packages/services/SettingsService/package.json', manifest);
  write('packages/services/SettingsService/README.md', '# readme\n');
  write('packages/services/SettingsService/LICENSE', 'license\n');
  write('packages/kernel/package.json', { name: '@brud/kernel', version: '0.0.1' });
  write('package-lock.json', { lockfileVersion: 3, packages: { '': { name: 'root' }, 'packages/services/SettingsService': { name: '@brud/settings', version } } });
  return { root, write };
}
const NOTES = (v) => `# settings ${v}\n\n## Summary\nA small release of the settings participant used by tests.\n\n## Changes\n### Fixed\n- **settings:** Fixed a thing. (#1)\n`;

test('tags are <name>@<version>, and cannot be mistaken for the BrudOS or CLI tags', () => {
  assert.equal(tagFor('settings', '0.1.0'), 'settings@0.1.0');
  assert.deepEqual(parseTag('settings@0.1.0-beta.1'), { name: 'settings', version: '0.1.0-beta.1' });
  for (const bad of ['v0.1.0', 'cli-v0.0.2', 'settings-0.1.0', 'Settings@1.0.0', '@brud/settings@1.0.0', 'a@b']) assert.equal(parseTag(bad), null, bad);
  assert.equal(/^v/.test(tagFor('settings', '1.0.0')) || /^cli-v/.test(tagFor('settings', '1.0.0')), false);
});

test('a consistent participant passes', () => {
  const { root } = makeRepo();
  assert.deepEqual(checkParticipant(root, 'settings', { version: '0.1.0', tag: 'settings@0.1.0' }), []);
});

test('reserved names and unknown packages are refused', () => {
  const { root } = makeRepo();
  for (const n of RESERVED) assert.match(checkParticipant(root, n)[0], /reserved/);
  assert.match(checkParticipant(root, 'nope')[0], /no workspace package/);
  assert.match(checkParticipant(root, 'Bad_Name')[0], /not a valid participant name/);
});

test('every problem is named', () => {
  const { root } = makeRepo('0.1.0', {
    brud: undefined, private: true, publishConfig: {}, files: ['dist', 'src'], scripts: { postinstall: 'x' },
    dependencies: { '@brud/kernel': '^0.0.1', '@brud/service-x': '*', '@brud/y': 'workspace:*' }, peerDependencies: {},
  });
  const p = checkParticipant(root, 'settings', { version: '0.2.0', tag: 'settings@0.1.0' }).join('\n');
  for (const re of [/does not match settings@0\.2\.0/, /role/, /version is 0\.1\.0, expected 0\.2\.0/, /marked private/, /publishConfig\.access/, /files must be exactly/, /install-time script/, /"\*"/, /workspace:\*/, /must be a peerDependency/, /must be declared in peerDependencies/, /package-lock\.json .* is 0\.1\.0/]) assert.match(p, re);
});

test('a missing README is reported', () => {
  const { root } = makeRepo();
  rmSync(join(root, 'packages/services/SettingsService/README.md'));
  assert.match(checkParticipant(root, 'settings', { version: '0.1.0' }).join(), /README\.md is missing/);
});

test('workspace scan finds participants by role, not by name', () => {
  const { root, write } = makeRepo();
  write('packages/other/package.json', { name: '@brud/other', version: '1.0.0' });
  assert.equal(listPackages(root).length, 3);
  assert.deepEqual(participants(root).map((p) => p.json.name), ['@brud/settings']);
});

test('release notes: title, summary and generated sections', () => {
  assert.deepEqual(checkNotes(NOTES('0.1.0'), 'settings', '0.1.0'), []);
  assert.match(checkNotes('# Other 0.1.0\n', 'settings', '0.1.0').join(), /first line must be "# settings 0\.1\.0"/);
  assert.match(checkNotes(`${NOTES('0.1.0')}\n## Packages\n`, 'settings', '0.1.0').join(), /remove "## Packages"/);
  assert.match(checkNotes(NOTES('0.1.0').replace('## Changes', '## Notes'), 'settings', '0.1.0').join(), /add "## Changes"/);
  assert.deepEqual(checkNotes(NOTES('0.1.0').replace('## Changes', '## Notes'), 'settings', '0.1.0', { first: true }), []);
  assert.match(checkNotes(`${NOTES('0.1.0')}\nSee .internal_docs/x\n`, 'settings', '0.1.0').join(), /internal ledger/);
});

test('the release body carries the notes, the package row and the verification section', () => {
  const body = buildBody({ notes: NOTES('0.1.0'), pkg: { name: '@brud/settings', version: '0.1.0', integrity: `sha512-${'a'.repeat(40)}` }, nodeRange: '>=22', commit: 'abc', tag: 'settings@0.1.0', repo: 'o/r', previousTag: 'settings@0.0.1' });
  for (const re of [/## Packages/, /@brud\/settings/, /brud add settings/, /Requires Node\.js >=22/, /## Verification/, /compare\/settings@0\.0\.1\.\.\.settings@0\.1\.0/]) assert.match(body, re);
});

test('pack takes a version after --from-registry (it must not be read as a flag)', () => {
  const parsed = parseArgs(['--name', 'settings', '--from-registry', '0.1.0', '--out', 'x'], ['ci', 'push', 'dry-run', 'sign']);
  assert.equal(parsed['from-registry'], '0.1.0');
  assert.equal(parsed.name, 'settings');
});

test('verify names the missing release notes and refuses a reserved name', () => {
  const { root } = makeRepo();
  const run = (extra) => spawnSync(process.execPath, [join(import.meta.dirname, '..', 'verify.mjs'), ...extra], { env: { ...process.env, BRUD_RELEASE_ROOT: root }, cwd: root, encoding: 'utf8' });
  const r = spawnSync('git', ['init', '-q'], { cwd: root });
  assert.equal(r.status, 0);
  const a = run(['--tag', 'settings@0.1.0']);
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /release notes are missing/);
  const b = run(['--tag', 'kernel@0.1.0']);
  assert.match(b.stderr, /reserved/);
});
