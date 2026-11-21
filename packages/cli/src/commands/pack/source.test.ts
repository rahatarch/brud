import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { languageOf, readSource, SOURCE_FILE } from './source.js';

const valid = (name: string): boolean => /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/u.test(name);
const base = { id: 'acme.x', manifest: { exposures: [] }, limits: { fuel: 1_000_000, maxMemoryBytes: 32 * 1024 * 1024 } };

function sourceWith(guest: unknown, limits: unknown = base.limits): string {
  const dir = mkdtempSync(join(tmpdir(), 'brud-source-'));

  writeFileSync(join(dir, SOURCE_FILE), JSON.stringify({ ...base, limits, guest }));

  return dir;
}

test('languageOf infers JavaScript from the extension and keeps .ts as AssemblyScript unless told', () => {
  assert.equal(languageOf({ source: 'src/index.js' }), 'javascript');
  assert.equal(languageOf({ source: 'src/index.mjs' }), 'javascript');
  assert.equal(languageOf({ source: 'assembly/index.ts' }), 'assemblyscript');
  assert.equal(languageOf({ source: 'src/index.ts', language: 'javascript' }), 'javascript');
  assert.throws(() => languageOf({ source: 'x.ts', language: 'rust' }), /language/u);
});

test('readSource accepts a JavaScript guest and rejects bad guest sections', () => {
  assert.equal(readSource(sourceWith({ source: 'src/index.ts', language: 'javascript' }), valid).guest.language, 'javascript');
  assert.throws(() => readSource(sourceWith({ source: 'a.js', module: 'b.wasm' }), valid), /exactly one/u);
  assert.throws(() => readSource(sourceWith({ source: 'a.js', other: 1 }), valid), /unknown key/u);
  assert.throws(() => readSource(sourceWith({ module: 'b.wasm', language: 'javascript' }), valid), /prebuilt/u);
});

test('a JavaScript guest needs at least 16 MiB of memory', () => {
  assert.throws(() => readSource(sourceWith({ source: 'a.js' }, { fuel: 1_000_000, maxMemoryBytes: 8 * 1024 * 1024 }), valid), /16 MiB/u);
  assert.equal(readSource(sourceWith({ source: 'a.js' }), valid).guest.source, 'a.js');
});
