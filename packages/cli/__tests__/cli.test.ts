import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brud, listTree, makeProject, runNodeTests, writeGuestFolder } from './helpers.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../../docs-next/examples/', import.meta.url));

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

test('help, version and unknown commands have documented exit codes', async (t) => {
  const dir = project(t);

  assert.equal((await brud(dir, ['--help'])).code, 0);
  assert.match((await brud(dir, ['--version'])).out, /^\d+\.\d+\.\d+/u);
  assert.equal((await brud(dir, ['bogus'])).code, 2);
  assert.equal((await brud(dir, ['check', '--nope'])).code, 2);
  assert.match((await brud(dir, ['doctor', '--help'])).out, /brud doctor/u);
});

test('the committed templates are the tested examples in docs-next/examples', () => {
  if (!existsSync(EXAMPLES)) {
    return;
  }

  for (const [example, template] of [['vault.mjs', 'participant.mjs'], ['vault.test.mjs', 'participant.test.mjs'], ['notes.mjs', 'kind.mjs']]) {
    assert.equal(readFileSync(join(TEMPLATES, template as string), 'utf8'), readFileSync(join(EXAMPLES, example as string), 'utf8'), `${template} drifted from ${example}; run \`npm run sync:templates\``);
  }
});

test('init scaffolds a project that passes doctor, check and its own tests', async (t) => {
  const dir = await scaffold(t, 'demo');
  const files = listTree(dir);

  assert.deepEqual(files, ['.gitignore', 'README.md', 'brud.config.json', 'package.json', 'participants/demo.mjs', 'test/demo.test.mjs']);
  assert.match(readFileSync(join(dir, 'participants', 'demo.mjs'), 'utf8'), /id: 'demo\.vault'/u);

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

test('read-only commands write nothing into the project', async (t) => {
  const dir = await scaffold(t, 'demo');
  const before = listTree(dir);

  await brud(dir, ['doctor', '--home', join(dir, 'h')]);
  await brud(dir, ['check']);
  await brud(dir, ['inspect']);
  await brud(dir, ['kinds']);

  assert.deepEqual(listTree(dir), before);
});

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

test('inspect lists participants, kinds and who can resolve a package exposure', async (t) => {
  const dir = await scaffold(t, 'demo');
  const guest = join(dir, 'guest');

  mkdirSync(guest);
  writeGuestFolder(guest);
  assert.equal((await brud(dir, ['pack', 'guest', '--out', join(dir, 'pkg')])).code, 0);

  const config = JSON.parse(readFileSync(join(dir, 'brud.config.json'), 'utf8')) as { services: unknown[] };

  config.services.push({ path: './pkg/brud.participant.json', official: false });
  writeFileSync(join(dir, 'brud.config.json'), JSON.stringify(config));

  const result = await brud(dir, ['inspect', '--json', '--cap', 'caged:read']);
  const data = JSON.parse(result.out) as { participants: { id: string }[]; packages: { exposures: { name: string; resolves: { none: boolean; policy: boolean; given: boolean } }[] }[] };

  assert.equal(result.code, 0, result.out);
  assert.ok(data.participants.some((participant) => participant.id === 'demo.vault' || participant.id.startsWith('demo.')));
  assert.deepEqual(data.packages[0]?.exposures[0]?.resolves, { none: false, policy: true, given: true });
});

const DOCUMENT = '[BRUD]\n[CALL note add]\ntext: hi\n[END]\n[CALL note list]\n[END]\n[/BRUD]';

test('call routes one document and exits 0, or 1 when the route fails', async (t) => {
  const dir = await scaffold(t, 'notes', ['--kind']);
  const state = join(dir, 'state');
  const ok = await brud(dir, ['call', DOCUMENT, '--state', state]);

  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual((JSON.parse(ok.out) as { operations: { result: { data: { notes?: string[] } } }[] }).operations.at(-1)?.result.data.notes, ['hi']);

  const stdin = await brud(dir, ['call', '-', '--state', state], DOCUMENT);

  assert.equal(stdin.code, 0, stdin.err);
  assert.equal((await brud(dir, ['call', '[BRUD]\n[CALL nope zap]\n[END]\n[/BRUD]', '--state', state])).code, 1);
  assert.equal((await brud(dir, ['call'])).code, 2);
});

test('run routes each document from stdin and keeps its identity between runs', async (t) => {
  const dir = await scaffold(t, 'notes', ['--kind']);
  const state = join(dir, 'state');
  const first = await brud(dir, ['run', '--state', state], `${DOCUMENT}\n${DOCUMENT}\n`);

  assert.equal(first.code, 0, first.err);
  assert.equal((first.out.match(/"status": "success"/gu) ?? []).length >= 2, true);
  assert.equal((await brud(dir, ['run', '--state', state], DOCUMENT)).code, 0);
});

test('call --daemon goes through the daemon with the ordinary client and tokens', async (t) => {
  const dir = await scaffold(t, 'notes', ['--kind']);
  const runtime = join(dir, 'rt');

  mkdirSync(runtime, { mode: 0o700 });

  const result = await brud(dir, ['call', '-', '--daemon', '--home', join(dir, 'home')], DOCUMENT, { BRUD_DAEMON_RUNTIME_DIR: runtime });

  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /"status": "success"/u);
  assert.ok(existsSync(join(dir, 'home', 'daemon.json')));
});

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

test('init --guest scaffolds a guest project without overwriting', async (t) => {
  const dir = project(t);
  const result = await brud(dir, ['init', 'tiny', '--guest']);

  assert.equal(result.code, 0, result.err);
  assert.ok(existsSync(join(dir, 'tiny', 'assembly', 'brud.ts')));
  assert.equal((await brud(dir, ['init', 'tiny', '--guest'])).code, 1);
});
