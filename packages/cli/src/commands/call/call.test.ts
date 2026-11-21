import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { DOCUMENT, brud, makeProject } from '../../testing/helpers.js';

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

test('call --daemon goes through the daemon with the ordinary client and tokens', async (t) => {
  const dir = await scaffold(t, 'notes', ['--kind']);
  const runtime = join(dir, 'rt');

  mkdirSync(runtime, { mode: 0o700 });

  const result = await brud(dir, ['call', '-', '--daemon', '--home', join(dir, 'home')], DOCUMENT, { BRUD_DAEMON_RUNTIME_DIR: runtime });

  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /"status": "success"/u);
  assert.ok(existsSync(join(dir, 'home', 'daemon.json')));
});
