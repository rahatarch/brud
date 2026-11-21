import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { brud, makeProject, writeGuestFolder } from '../../testing/helpers.js';

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
