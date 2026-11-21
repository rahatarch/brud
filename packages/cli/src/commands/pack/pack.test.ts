import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { brud, makeProject, writeGuestFolder } from '../../testing/helpers.js';

function project(t: TestContext): string {
  const made = makeProject();

  t.after(made.cleanup);

  return made.dir;
}

test('pack builds a package from a prebuilt guest and --verify boots it', async (t) => {
  const dir = project(t);

  writeGuestFolder(dir);

  const result = await brud(dir, ['pack', '--verify']);
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'brud.participant.json'), 'utf8')) as { format: number; id: string; cage: { module: string; sha256: string } };

  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(manifest.format, 1);
  assert.equal(manifest.cage.module, 'participant.wasm');
  assert.match(manifest.cage.sha256, /^[0-9a-f]{64}$/u);
  assert.match(result.out, /resolves only with caged:read/u);
});

test('pack refuses a requires section, unknown keys, escaping paths and a missing toolchain', async (t) => {
  const dir = project(t);

  writeGuestFolder(dir, { requires: { official: true } });
  assert.match((await brud(dir, ['pack'])).err, /PACK_REQUIRES_OFFICIAL/u);

  writeGuestFolder(dir, { surprise: true });
  assert.match((await brud(dir, ['pack'])).err, /unknown key/u);

  writeGuestFolder(dir, { guest: { module: '../outside.wasm' } });
  assert.match((await brud(dir, ['pack'])).err, /inside the guest folder/u);

  writeGuestFolder(dir, { guest: { source: 'assembly/index.ts' } });
  assert.match((await brud(dir, ['pack'])).err, /PACK_TOOLCHAIN_MISSING/u);
});
