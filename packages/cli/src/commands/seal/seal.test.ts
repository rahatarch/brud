import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { brud, makeProject } from '../../testing/helpers.js';

const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

test('brud seal writes the seal and prints the digest the built product must hold', async (t) => {
  const made = makeProject();

  t.after(made.cleanup);
  writeFileSync(join(made.dir, 'brud.config.json'), JSON.stringify({ services: [...HARDCORES, { path: './loaded.json' }] }));

  const result = await brud(made.dir, ['seal', '--json']);

  assert.equal(result.code, 0, result.out + result.err);

  const report = JSON.parse(result.out) as { seal: string; digest: string };
  const text = readFileSync(report.seal, 'utf8');

  assert.equal(report.digest, createHash('sha256').update(text).digest('hex'));
  assert.deepEqual((JSON.parse(text) as { participants: { path: string }[] }).participants.map((entry) => entry.path), HARDCORES.map((entry) => entry.path));
});

test('brud seal says what is wrong when the config is missing', async (t) => {
  const made = makeProject();

  t.after(made.cleanup);

  const result = await brud(made.dir, ['seal']);

  assert.notEqual(result.code, 0);
  assert.match(result.err + result.out, /brud\.config\.json/u);
});
