import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { brud, GUEST_WASM_HEX, makeProject } from './helpers.js';

const NPM_ENV = { npm_config_cache: process.env.npm_config_cache ?? '/tmp/npmcache', npm_config_logs_dir: process.env.npm_config_logs_dir ?? '/tmp/npmlogs' };

function project(t: TestContext): string {
  const made = makeProject();

  t.after(made.cleanup);
  writeFileSync(join(made.dir, 'package.json'), JSON.stringify({ name: 'proj', version: '1.0.0', private: true }));

  return made.dir;
}

/** A participant package folder next to the project, with tweakable pieces. */
function fixture(root: string, name: string, tweak: { requires?: unknown; scripts?: Record<string, string>; peer?: string; noData?: boolean; badHash?: boolean } = {}): string {
  const dir = join(root, name);
  const wasm = Buffer.from(GUEST_WASM_HEX, 'hex');

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'participant.wasm'), wasm);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `acme-${name}`, version: '1.0.0', files: ['participant.wasm', 'brud.participant.json'], scripts: tweak.scripts, peerDependencies: { '@brud/kernel': tweak.peer ?? '*' } }));

  if (tweak.noData !== true) {
    writeFileSync(join(dir, 'brud.participant.json'), JSON.stringify({
      format: 1,
      id: 'acme.caged',
      manifest: { requests: { capabilities: [] }, exposures: [{ name: 'acme.caged.read', version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: ['caged:read'] } }] },
      cage: { module: 'participant.wasm', sha256: tweak.badHash === true ? '0'.repeat(64) : createHash('sha256').update(wasm).digest('hex'), limits: { fuel: 1_000_000, maxMemoryBytes: 16_777_216, deadlineMs: 5000 } },
      ...(tweak.requires === undefined ? {} : { requires: tweak.requires }),
    }));
  }

  return dir;
}

test('add refuses an ordinary npm package and installs nothing', async (t) => {
  const dir = project(t);

  fixture(dir, 'plain', { noData: true });

  const result = await brud(dir, ['add', './plain'], '', NPM_ENV);

  assert.equal(result.code, 1, result.err);
  assert.match(result.out + result.err, /ordinary npm package/u);
  assert.equal(existsSync(join(dir, 'node_modules', 'acme-plain')), false);
});

test('add refuses a package whose cage module does not match its hash', async (t) => {
  const dir = project(t);

  fixture(dir, 'bad', { badHash: true });

  const result = await brud(dir, ['add', './bad'], '', NPM_ENV);

  assert.equal(result.code, 1, result.err);
  assert.match(result.out + result.err, /sha256/u);
  assert.equal(existsSync(join(dir, 'node_modules', 'acme-bad')), false);
});

test('add refuses a package built for a different kernel version', async (t) => {
  const dir = project(t);

  fixture(dir, 'old', { peer: '^9.0.0' });

  const result = await brud(dir, ['add', './old'], '', NPM_ENV);

  assert.equal(result.code, 1, result.err);
  assert.match(result.out + result.err, /\^9\.0\.0/u);
});

test('add --dry-run inspects and boots but installs nothing; add --write lists a caged package as not official', async (t) => {
  const dir = project(t);

  fixture(dir, 'good', { scripts: { postinstall: 'echo hi' } });
  writeFileSync(join(dir, 'brud.config.json'), JSON.stringify({ services: [] }));

  const dry = await brud(dir, ['add', './good', '--dry-run'], '', NPM_ENV);

  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /boots in a scratch kernel/u);
  assert.match(dry.out, /install scripts/u);
  assert.equal(existsSync(join(dir, 'node_modules', 'acme-good')), false);

  const real = await brud(dir, ['add', './good', '--write'], '', NPM_ENV);

  assert.equal(real.code, 0, real.out + real.err);
  assert.ok(existsSync(join(dir, 'node_modules', 'acme-good', 'brud.participant.json')));

  const config = JSON.parse(readFileSync(join(dir, 'brud.config.json'), 'utf8')) as { services: { path: string; official: boolean }[] };

  assert.deepEqual(config.services, [{ path: './node_modules/acme-good/brud.participant.json', official: false }]);
});

test('add never writes an official entry for a package that requires official', async (t) => {
  const dir = project(t);

  fixture(dir, 'power', { requires: { official: true, powers: [] } });
  writeFileSync(join(dir, 'brud.config.json'), JSON.stringify({ services: [] }));

  const result = await brud(dir, ['add', './power', '--write'], '', NPM_ENV);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /official/u);
  assert.deepEqual((JSON.parse(readFileSync(join(dir, 'brud.config.json'), 'utf8')) as { services: unknown[] }).services, []);
});

test('add rejects unsafe specs and needs a package argument', async (t) => {
  const dir = project(t);

  assert.equal((await brud(dir, ['add'])).code, 2);
  assert.match((await brud(dir, ['add', 'x & calc'])).err, /UNSAFE_SPEC/u);
});
