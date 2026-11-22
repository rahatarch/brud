import { strict as assert } from 'node:assert';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildBody, checkCli, checkNotes, tagFor } from '../lib/cli.mjs';
import { makeRepo } from './helpers.mjs';

const NOTES = (v) => `# Brud CLI ${v}\n\n## Summary\nA small patch release of the Brud CLI used by tests.\n\n## Changes\n### Fixed\n- **cli:** Fixed a thing. (#1)\n`;

test('tagFor uses the cli-v prefix, which the BrudOS v* trigger cannot match', () => {
  assert.equal(tagFor('0.0.2'), 'cli-v0.0.2');
  assert.equal(/^v/.test(tagFor('0.0.2')), false);
});

test('checkCli accepts a consistent tree and the matching tag', () => {
  const { root } = makeRepo('0.0.2');
  assert.deepEqual(checkCli(root, { version: '0.0.2', tag: 'cli-v0.0.2' }), []);
});

test('checkCli names every problem', () => {
  const { root } = makeRepo('0.0.1', { private: true, bin: { brud: 'src/x.js' }, publishConfig: {}, scripts: { postinstall: 'x' }, dependencies: { '@brud/kernel': 'workspace:*' } });
  const p = checkCli(root, { version: '0.0.2', tag: 'v0.0.2' }).join('\n');
  for (const re of [/does not match version 0\.0\.2/, /version is 0\.0\.1, expected 0\.0\.2/, /marked private/, /bin\.brud/, /publishConfig\.access/, /install-time script/, /workspace:\*/, /package-lock\.json .* is 0\.0\.1/]) assert.match(p, re);
});

test('checkCli rejects an invalid version and a missing README', () => {
  const { root } = makeRepo('0.0.1');
  assert.match(checkCli(root, { version: 'nope' })[0], /not a valid version/);
  rmSync(join(root, 'packages/cli/README.md'));
  assert.match(checkCli(root, { version: '0.0.1' }).join(), /README\.md is missing/);
});

test('notes: header, summary, generated sections, placeholders, leaks', () => {
  assert.deepEqual(checkNotes(NOTES('0.0.2'), '0.0.2'), []);
  assert.match(checkNotes(NOTES('0.0.2').replace('# Brud CLI', '# BrudOS'), '0.0.2').join(), /first line must be "# Brud CLI 0\.0\.2"/);
  assert.match(checkNotes(NOTES('0.0.2').replace('## Changes', '## Packages'), '0.0.2').join(), /remove "## Packages"/);
  assert.match(checkNotes(`${NOTES('0.0.2')}\nTODO later\n`, '0.0.2').join(), /placeholder/);
  assert.match(checkNotes(`${NOTES('0.0.2')}\nsee .internal_docs/x\n`, '0.0.2').join(), /internal ledger/);
  assert.match(checkNotes(NOTES('0.0.2').replace(/## Changes[\s\S]*/, ''), '0.0.2').join(), /add "## Changes"/);
  assert.deepEqual(checkNotes(NOTES('0.0.1').replace(/## Changes[\s\S]*/, ''), '0.0.1', { first: true }), []);
});

test('buildBody adds Packages and Verification and never claims BrudOS packages', () => {
  const body = buildBody({ notes: NOTES('0.0.2'), pkg: { name: '@brud/cli', version: '0.0.2', integrity: 'sha512-abcdefghijklmnopqrstuvwxyz' }, nodeRange: '>=22', commit: 'abc', tag: 'cli-v0.0.2', repo: 'o/r', previousTag: 'cli-v0.0.1' });
  assert.match(body, /## Packages/);
  assert.match(body, /npm install -g @brud\/cli/);
  assert.match(body, /compare\/cli-v0\.0\.1\.\.\.cli-v0\.0\.2/);
  assert.doesNotMatch(body, /@brud\/kernel/);
});
