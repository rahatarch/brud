import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { brud, makeProject } from '../../testing/helpers.js';

function project(t: TestContext): string {
  const made = makeProject();

  t.after(made.cleanup);

  return made.dir;
}

async function scaffold(t: TestContext, name: string, flags: readonly string[] = []): Promise<string> {
  const dir = project(t);
  const result = await brud(dir, ['init', name, '--no-install', ...flags]);

  assert.equal(result.code, 0, result.err);

  return join(dir, name);
}

test('check and doctor explain a bad composition with a cause and a fix, and exit 1', async (t) => {
  const dir = project(t);

  writeFileSync(join(dir, 'x.mjs'), 'export const createService = () => ({});\n');
  writeFileSync(join(dir, 'brud.config.json'), JSON.stringify({ services: [{ path: './x.mjs' }] }));

  for (const command of ['check', 'doctor']) {
    const result = await brud(dir, [command, '--home', join(dir, 'h')]);

    assert.equal(result.code, 1);
    assert.match(result.out, /PARTICIPANT_TIER/u);
    assert.match(result.out, /fix:/u);
  }

  assert.equal((await brud(dir, ['check', join(dir, 'missing.json')])).code, 1);
});

test('a package that requires official is reported with the exact line to add, and never granted', async (t) => {
  const dir = await scaffold(t, 'demo');
  const config = JSON.parse(readFileSync(join(dir, 'brud.config.json'), 'utf8')) as { services: unknown[] };

  mkdirSync(join(dir, 'fs'));
  writeFileSync(join(dir, 'fs', 'brud.participant.json'), JSON.stringify({
    format: 1,
    id: 'acme.fs',
    manifest: { requests: { capabilities: [] }, exposures: [] },
    cage: { module: 'participant.wasm', sha256: '0'.repeat(64), limits: { fuel: 1, maxMemoryBytes: 65_536 } },
    requires: { official: true, powers: ['filesystem', 'process'] },
  }));
  config.services.push({ path: './fs/brud.participant.json', official: false });
  writeFileSync(join(dir, 'brud.config.json'), JSON.stringify(config));

  const result = await brud(dir, ['check']);

  assert.equal(result.code, 1);
  assert.match(result.out, /requires official \(powers: filesystem, process\)/u);
  assert.match(result.out, /"official": true/u);
  assert.match(readFileSync(join(dir, 'brud.config.json'), 'utf8'), /"official":false/u, 'the CLI must not edit the composition');
});
