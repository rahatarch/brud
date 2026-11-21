import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { brud, listTree, makeProject } from './testing/helpers.js';

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

test('read-only commands write nothing into the project', async (t) => {
  const dir = await scaffold(t, 'demo');
  const before = listTree(dir);

  await brud(dir, ['doctor', '--home', join(dir, 'h')]);
  await brud(dir, ['check']);
  await brud(dir, ['inspect']);
  await brud(dir, ['kinds']);

  assert.deepEqual(listTree(dir), before);
});
