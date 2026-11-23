import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { main } from '../main.js';
import type { Io } from './io.js';

function run(argv: readonly string[], isTty: boolean, env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string }> {
  let out = '';
  const io: Io = { out: (text) => { out += text; }, err: () => undefined, cwd: process.cwd(), env, stdin: new PassThrough(), isTty };

  return main(argv, io).then((code) => ({ code, out }));
}

test('--version at a terminal shows the brand, the version, the licence and the copyright', async () => {
  const { code, out } = await run(['--version'], true, { NO_COLOR: '1' });

  assert.equal(code, 0);
  assert.match(out, /\|____\/ \|_\| \\_\\ /u);
  assert.match(out, /Brud CLI \d+\.\d+\.\d+/u);
  assert.match(out, /License: Apache-2\.0/u);
  assert.match(out, /© 2026 Brud Foundation\. All rights reserved\./u);
  assert.doesNotMatch(out, /\x1b\[/u, 'NO_COLOR keeps it plain');
});

test('--version into a pipe is the bare version, so scripts keep working', async () => {
  const { out } = await run(['--version'], false);

  assert.match(out, /^\d+\.\d+\.\d+\n$/u);
});

test('the wordmark is coloured at a terminal that takes colour', async () => {
  const { out } = await run(['--version'], true);

  assert.match(out, /\x1b\[36m/u);
});

test('--help at a terminal starts with the brand; into a pipe it does not', async () => {
  const terminal = await run(['--help'], true, { NO_COLOR: '1' });
  const piped = await run(['--help'], false);

  assert.match(terminal.out, /\|____\/ \|_\| \\_\\ /u);
  assert.match(terminal.out, /Usage: brud <command>/u);
  assert.doesNotMatch(piped.out, /\|____\//u);
  assert.match(piped.out, /^brud \d+\.\d+\.\d+ - /u);
  assert.doesNotMatch(terminal.out, /\x1b\[/u, 'NO_COLOR keeps it plain');
});
