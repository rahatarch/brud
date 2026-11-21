import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadRuntime } from './runtime.js';

test('the shipped runtime matches its pinned digest and carries one script slot', () => {
  const bytes = loadRuntime();

  assert.ok(bytes.length > 1_000_000);
  assert.equal(bytes.indexOf(Buffer.from('BRUD-JS-SLOT-v1\0', 'latin1')) > 0, true);
});

test('loadRuntime refuses a missing file and a file that does not match the digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brud-runtime-'));
  const file = join(dir, 'quickjs.wasm');

  assert.throws(() => loadRuntime(file, 'x'), /missing/u);
  writeFileSync(file, 'tampered');
  assert.throws(() => loadRuntime(file, createHash('sha256').update('other').digest('hex')), /does not match the digest/u);
  assert.equal(loadRuntime(file, createHash('sha256').update('tampered').digest('hex')).toString(), 'tampered');
});
