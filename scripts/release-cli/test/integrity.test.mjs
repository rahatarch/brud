import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide } from '../lib/publish-plan.mjs';
import { parseSums, sriSha512, verifySums, writeSums } from '../lib/integrity.mjs';

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-sums-'));
  writeFileSync(join(dir, 'a.tgz'), 'alpha');
  writeFileSync(join(dir, 'b.tgz'), 'beta');
  return dir;
};

test('checksums round-trip and verify', () => {
  const dir = fixture();
  writeSums(dir, ['a.tgz', 'b.tgz']);
  assert.deepEqual(verifySums(dir), []);
  assert.equal(parseSums('0'.repeat(64) + '  a.tgz\n').length, 1);
});

test('a changed or missing file is caught', () => {
  const dir = fixture();
  writeSums(dir, ['a.tgz', 'b.tgz']);
  writeFileSync(join(dir, 'a.tgz'), 'tampered');
  assert.match(verifySums(dir).join(), /a\.tgz does not match/);
  assert.match(verifySums(mkdtempSync(join(tmpdir(), 'brud-empty-'))).join(), /missing/);
});

test('a malformed SHA256SUMS is rejected', () => {
  assert.throws(() => parseSums('not a checksum line\n'));
});

test('integrity uses npm sha512 SRI format', () => {
  const dir = fixture();
  assert.match(sriSha512(join(dir, 'a.tgz')), /^sha512-[A-Za-z0-9+/]+=*$/);
});

test('publish decision: publish, skip identical, stop on different bytes', () => {
  assert.equal(decide('sha512-a', null), 'publish');
  assert.equal(decide('sha512-a', undefined), 'publish');
  assert.equal(decide('sha512-a', 'sha512-a'), 'skip');
  assert.equal(decide('sha512-a', 'sha512-b'), 'conflict');
});
