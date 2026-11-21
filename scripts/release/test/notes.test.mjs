import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildBody, checkNotes } from '../lib/notes.mjs';

const good = `# BrudOS 0.0.2

## Summary
A patch release that fixes two bugs in the daemon.

## Changes
### Fixed
- **daemon:** Closed idle sockets. (#12)
`;

test('good notes pass', () => assert.deepEqual(checkNotes(good, '0.0.2'), []));

test('the title must carry the version', () => {
  assert.ok(checkNotes(good.replace('0.0.2', '0.0.3'), '0.0.2').some((p) => /first line/.test(p)));
});

test('Summary and Changes are required, except Changes on a first release', () => {
  const noChanges = '# BrudOS 0.0.1\n\n## Summary\nThe first public release of the core.\n';
  assert.ok(checkNotes(noChanges, '0.0.1').some((p) => /Changes/.test(p)));
  assert.deepEqual(checkNotes(noChanges, '0.0.1', { first: true }), []);
  assert.ok(checkNotes('# BrudOS 0.0.1\n\n## Changes\n- x\n', '0.0.1').some((p) => /Summary/.test(p)));
  assert.ok(checkNotes('# BrudOS 0.0.1\n\n## Summary\nshort\n', '0.0.1', { first: true }).some((p) => /too short/.test(p)));
});

test('generated sections must not be written by hand', () => {
  const text = `${good}\n## Packages\n| a |\n## Verification\nx\n`;
  const problems = checkNotes(text, '0.0.2');
  assert.ok(problems.some((p) => /Packages/.test(p)));
  assert.ok(problems.some((p) => /Verification/.test(p)));
});

test('placeholders and leaks are caught', () => {
  assert.ok(checkNotes(`${good}\n- **<component>:** <what changed>\n`, '0.0.2').some((p) => /placeholder/.test(p)));
  assert.ok(checkNotes(`${good}\nTODO fix this\n`, '0.0.2').some((p) => /placeholder/.test(p)));
  assert.ok(checkNotes(`${good}\nSee .internal_docs/x.md\n`, '0.0.2').some((p) => /internal ledger/.test(p)));
  assert.ok(checkNotes(`${good}\nBuilt in /home/me/work\n`, '0.0.2').some((p) => /machine-specific/.test(p)));
  assert.ok(checkNotes(`${good}\nnpm_abcdefghijklmnopqrstuvwxyz0123\n`, '0.0.2').some((p) => /npm token/.test(p)));
  assert.ok(checkNotes(`${good}\nghp_abcdefghijklmnopqrstuvwxyz0123\n`, '0.0.2').some((p) => /GitHub token/.test(p)));
});

test('the body appends Packages and Verification and a compare link', () => {
  const body = buildBody({
    notes: good,
    packages: [{ name: '@brud/kernel', version: '0.0.2', integrity: `sha512-${'A'.repeat(40)}` }],
    nodeRange: '>=22',
    commit: 'abc123', tag: 'v0.0.2', runUrl: 'https://example.test/run/1',
    repo: 'o/r', previousTag: 'v0.0.1',
  });
  assert.match(body, /## Packages/);
  assert.match(body, /\| `@brud\/kernel` \| 0\.0\.2 \|/);
  assert.match(body, /Requires Node\.js >=22\./);
  assert.match(body, /## Verification/);
  assert.match(body, /abc123/);
  assert.match(body, /compare\/v0\.0\.1\.\.\.v0\.0\.2/);
  assert.deepEqual(checkNotes(body.replace(/## Packages[\s\S]*/, ''), '0.0.2'), []);
});

test('with no previous tag the body links the commit history', () => {
  const body = buildBody({ notes: good, packages: [], commit: 'x', tag: 'v0.0.1', repo: 'o/r' });
  assert.match(body, /commits\/v0\.0\.1/);
});
