import assert from 'node:assert/strict';
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

test('run routes each document from stdin and keeps its identity between runs', async (t) => {
  const dir = await scaffold(t, 'notes', ['--kind']);
  const state = join(dir, 'state');
  const first = await brud(dir, ['run', '--state', state], `${DOCUMENT}\n${DOCUMENT}\n`);

  assert.equal(first.code, 0, first.err);
  assert.equal((first.out.match(/"status": "success"/gu) ?? []).length >= 2, true);
  assert.equal((await brud(dir, ['run', '--state', state], DOCUMENT)).code, 0);
});
