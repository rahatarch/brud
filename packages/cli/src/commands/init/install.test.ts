import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { parseArgs } from '../../core/args.js';
import type { Io } from '../../core/io.js';
import { runInit } from './index.js';
import { INIT_FLAGS } from './index.js';
import { runInitGuest } from './guest/index.js';

interface Session { readonly io: Io; readonly output: () => string; readonly answer: (text: string) => void }

/** A terminal session: a TTY on both streams, with the answers a person would type. */
function terminal(cwd: string, tty = true): Session {
  let out = '';
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };

  stdin.isTTY = tty;

  return { io: { out: (text) => { out += text; }, err: () => undefined, cwd, env: {}, stdin, isTty: tty }, output: () => out, answer: (text) => { stdin.write(text); } };
}

function workdir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'brud-prompt-'));

  t.after(() => { rmSync(dir, { recursive: true, force: true }); });

  return dir;
}

const style = { json: false, color: false };
const noKernel = () => Promise.resolve(undefined);

test('init asks, and a yes installs the packages', async (t) => {
  const cwd = workdir(t);
  const session = terminal(cwd);
  const installed: string[] = [];

  session.answer('y\n');

  await assert.rejects(
    runInit(session.io, style, parseArgs(['demo'], INIT_FLAGS), noKernel, (dir) => { installed.push(dir); return Promise.resolve(); }),
    /PACKAGE_NOT_FOUND|not in/u,
  );
  assert.match(session.output(), /Install the packages now\? This runs `npm install` in demo\. \[Y\/n\]/u);
  assert.deepEqual(installed, [join(cwd, 'demo')]);
});

test('init asks, and a no leaves the packages alone and says how to finish', async (t) => {
  const session = terminal(workdir(t));
  const installed: string[] = [];

  session.answer('n\n');

  const code = await runInit(session.io, style, parseArgs(['demo'], INIT_FLAGS), noKernel, (dir) => { installed.push(dir); return Promise.resolve(); });

  assert.equal(code, 0);
  assert.deepEqual(installed, []);
  assert.match(session.output(), /Not finished/u);
});

test('an empty answer takes the default, which installs', async (t) => {
  const session = terminal(workdir(t));
  const installed: string[] = [];

  session.answer('\n');
  await runInit(session.io, style, parseArgs(['demo'], INIT_FLAGS), noKernel, (dir) => { installed.push(dir); return Promise.resolve(); }).catch(() => undefined);

  assert.equal(installed.length, 1);
});

test('--install and --no-install decide without asking, and cannot be combined', async (t) => {
  const withFlag = async (flag: string): Promise<{ asked: boolean; installed: number }> => {
    const session = terminal(workdir(t));
    let installed = 0;

    await runInit(session.io, style, parseArgs(['demo', flag], INIT_FLAGS), noKernel, () => { installed += 1; return Promise.resolve(); }).catch(() => undefined);

    return { asked: session.output().includes('[Y/n]'), installed };
  };

  assert.deepEqual(await withFlag('--install'), { asked: false, installed: 1 });
  assert.deepEqual(await withFlag('--no-install'), { asked: false, installed: 0 });
  await assert.rejects(runInit(terminal(workdir(t)).io, style, parseArgs(['demo', '--install', '--no-install'], INIT_FLAGS), noKernel), /cannot be used together/u);
});

test('with no one to ask, init installs as it always did, and a guest project does not', async (t) => {
  const quiet = terminal(workdir(t), false);
  const installed: string[] = [];

  await runInit(quiet.io, style, parseArgs(['demo'], INIT_FLAGS), noKernel, (dir) => { installed.push(dir); return Promise.resolve(); }).catch(() => undefined);

  assert.equal(quiet.output().includes('[Y/n]'), false);
  assert.equal(installed.length, 1);

  const guest = terminal(workdir(t), false);

  await runInitGuest(guest.io, style, parseArgs(['g', '--guest'], INIT_FLAGS), () => { installed.push('guest'); return Promise.resolve(); });

  assert.equal(installed.includes('guest'), false);
});

test('a guest project asks too, and says nothing about installing when the answer was yes', async (t) => {
  const session = terminal(workdir(t));
  const installed: string[] = [];

  session.answer('yes\n');
  await runInitGuest(session.io, style, parseArgs(['g', '--guest'], INIT_FLAGS), (dir) => { installed.push(dir); return Promise.resolve(); });

  assert.equal(installed.length, 1);
  assert.doesNotMatch(session.output(), /\n {2}npm install\n/u);
});
