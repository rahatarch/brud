import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockedIntegrity, tarballIntegrity } from './integrity.js';

test('tarballIntegrity is npm-style sha512 and lockedIntegrity reads the lockfile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-integrity-'));

  writeFileSync(join(dir, 'a.tgz'), 'bytes');
  assert.match(tarballIntegrity(join(dir, 'a.tgz')), /^sha512-[A-Za-z0-9+/]+=*$/u);
  assert.equal(lockedIntegrity(dir, 'x'), undefined);

  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/x': { integrity: 'sha512-abc' } } }));
  assert.equal(lockedIntegrity(dir, 'x'), 'sha512-abc');
  assert.equal(lockedIntegrity(dir, 'y'), undefined);
});
