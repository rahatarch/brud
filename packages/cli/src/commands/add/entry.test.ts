import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { entryPath, writeEntry } from './entry.js';

test('entryPath is relative to the composition with forward slashes', () => {
  assert.equal(entryPath('/p/brud.config.json', '/p', 'acme-x'), './node_modules/acme-x/brud.participant.json');
  assert.equal(entryPath('/p/config/brud.config.json', '/p', '@acme/x'), '../node_modules/@acme/x/brud.participant.json');
});

test('writeEntry adds a not-official entry once and keeps other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-entry-'));
  const file = join(dir, 'brud.config.json');

  writeFileSync(file, JSON.stringify({ services: [{ path: 'a.mjs', official: true }], exposureOwners: { x: 'y' } }));

  assert.equal(writeEntry(file, './p.json'), 'added');
  assert.equal(writeEntry(file, './p.json'), 'present');

  const config = JSON.parse(readFileSync(file, 'utf8')) as { services: unknown[]; exposureOwners: unknown };

  assert.deepEqual(config.services, [{ path: 'a.mjs', official: true }, { path: './p.json', official: false }]);
  assert.deepEqual(config.exposureOwners, { x: 'y' });
});
