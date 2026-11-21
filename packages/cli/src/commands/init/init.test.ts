import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { PACKAGE_ROOT, TEMPLATES_DIR } from '../../core/paths.js';
import { brud, linkEsbuild, listTree, makeProject, runNodeTests } from '../../testing/helpers.js';

const EXAMPLES = join(PACKAGE_ROOT, '..', '..', 'docs-next', 'examples');

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

test('the committed templates are the tested examples in docs-next/examples', () => {
  if (!existsSync(EXAMPLES)) {
    return;
  }

  for (const [example, template] of [['vault.mjs', 'participant.mjs'], ['vault.test.mjs', 'participant.test.mjs'], ['notes.mjs', 'kind.mjs']]) {
    assert.equal(readFileSync(join(TEMPLATES_DIR, template as string), 'utf8'), readFileSync(join(EXAMPLES, example as string), 'utf8'), `${template} drifted from ${example}; run \`npm run sync:templates\``);
  }
});

test('init scaffolds a project that passes doctor, check and its own tests', async (t) => {
  const dir = await scaffold(t, 'demo');
  const files = listTree(dir);

  assert.deepEqual(files, [
    '.editorconfig',
    '.github/workflows/ci.yml',
    '.gitignore',
    '.nvmrc',
    'README.md',
    'brud.config.json',
    'config/daemon.example.json',
    'docs/architecture.md',
    'package.json',
    'src/participants/demo/index.mjs',
    'test/participants/demo.test.mjs',
  ].sort());
  assert.match(readFileSync(join(dir, 'src', 'participants', 'demo', 'index.mjs'), 'utf8'), /id: 'demo\.vault'/u);

  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string>; engines: { node: string }; dependencies: Record<string, string> };

  assert.deepEqual(Object.keys(manifest.scripts).sort(), ['call', 'check', 'doctor', 'inspect', 'start', 'test']);
  assert.equal(manifest.engines.node, '>=22');
  assert.ok(manifest.dependencies['@brud/kernel'] !== undefined && manifest.dependencies['@brud/sdk'] !== undefined);
  assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /^# demo\n/u);
  assert.match(readFileSync(join(dir, 'brud.config.json'), 'utf8'), /\.\/src\/participants\/demo\/index\.mjs/u);

  // The shipped operator-config example is valid once copied into a daemon home.
  mkdirSync(join(dir, '.brud', 'daemon'), { recursive: true });
  writeFileSync(join(dir, '.brud', 'daemon', 'daemon.json'), readFileSync(join(dir, 'config', 'daemon.example.json'), 'utf8'));

  const daemonDoctor = await brud(dir, ['doctor', '--home', join(dir, '.brud', 'daemon')]);

  assert.match(daemonDoctor.out, /daemon\.json is valid and its composition resolves/u);

  const doctor = await brud(dir, ['doctor', '--json', '--home', join(dir, 'no-daemon-home')]);

  assert.equal(doctor.code, 0, doctor.out);
  assert.equal((JSON.parse(doctor.out) as { ok: boolean }).ok, true);
  assert.equal((await brud(dir, ['check'])).code, 0);

  const tests = runNodeTests(dir);

  assert.equal(tests.status, 0, tests.output);
});

test('init --kind scaffolds a kind owner that routes Brud text and passes its own tests', async (t) => {
  const dir = await scaffold(t, 'notes', ['--kind']);

  assert.equal(runNodeTests(dir).status, 0);
  assert.match((await brud(dir, ['kinds'])).out, /note - Keep short notes/u);
  assert.ok(existsSync(join(dir, 'examples', 'notes.brud')));
  assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /owns the `note` kind/u);

  const sample = await brud(dir, ['call', '--file', 'examples/notes.brud', '--state', join(dir, 'state')]);

  assert.equal(sample.code, 0, sample.err);
  assert.match(sample.out, /"status": "success"/u);
});

test('init never overwrites and rejects names a participant cannot have', async (t) => {
  const dir = await scaffold(t, 'demo');
  const before = readFileSync(join(dir, 'package.json'), 'utf8');
  const again = await brud(join(dir, '..'), ['init', 'demo', '--no-install']);

  assert.equal(again.code, 1);
  assert.match(again.err, /refusing to overwrite/u);
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
  assert.equal((await brud(join(dir, '..'), ['init', 'Bad_Name!', '--no-install'])).code, 2);
});

test('init --guest scaffolds a guest project without overwriting', async (t) => {
  const dir = project(t);
  const result = await brud(dir, ['init', 'tiny', '--guest']);

  assert.equal(result.code, 0, result.err);
  assert.ok(existsSync(join(dir, 'tiny', 'assembly', 'brud.ts')));
  assert.equal((await brud(dir, ['init', 'tiny', '--guest'])).code, 1);
});

test('init --guest --lang js|ts scaffold a project that packs, and a bad --lang is a usage error', async (t) => {
  for (const [lang, entry] of [['js', 'src/index.js'], ['ts', 'src/index.ts']] as const) {
    const dir = project(t);
    const result = await brud(dir, ['init', 'tiny', '--guest', '--lang', lang]);

    assert.equal(result.code, 0, result.err);

    const root = join(dir, 'tiny');
    const source = JSON.parse(readFileSync(join(root, 'brud.participant.src.json'), 'utf8')) as { guest: { source: string; language: string }; limits: { fuel: number } };

    assert.deepEqual(source.guest, { source: entry, language: 'javascript' });
    assert.ok(source.limits.fuel >= 2_000_000_000);
    assert.ok(existsSync(join(root, entry)));
    assert.equal(existsSync(join(root, 'assembly')), false);
    assert.equal(existsSync(join(root, 'src', 'brud.ts')), lang === 'ts');

    linkEsbuild(dir);

    const packed = await brud(root, ['pack', '--verify']);

    assert.equal(packed.code, 0, packed.out + packed.err);
    assert.match(packed.out, /Exposure tiny\.guest\.hello resolves only with tiny:read/u);
  }

  assert.equal((await brud(project(t), ['init', 'x', '--guest', '--lang', 'rust'])).code, 2);
});
