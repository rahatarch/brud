// `brud init` in a project that has no kernel: the case the in-repository tests cannot see,
// because inside this repository the CLI's own install tree always supplies a kernel.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test, type TestContext } from 'node:test';
import type { KernelPackage } from '../../composition/load.js';
import { parseArgs } from '../../core/args.js';
import { CommandError } from '../../core/errors.js';
import type { Io } from '../../core/io.js';
import { makeProject } from '../../testing/helpers.js';
import { type KernelLoader } from './config.js';
import { INIT_FLAGS, runInit } from './index.js';

const none: KernelLoader = () => Promise.reject(new CommandError('PACKAGE_NOT_FOUND', '@brud/kernel is not installed here'));

/** A stand-in kernel whose hardcore modules are exactly `modules`. */
function fakeKernel(root: string, modules: readonly string[]): KernelLoader {
  const directory = join(root, 'dist', 'serviceModules');

  mkdirSync(directory, { recursive: true });

  for (const file of modules) {
    writeFileSync(join(directory, file), '');
  }

  return () => Promise.resolve({ name: '@brud/kernel', root, version: '0.0.0', module: {} } as unknown as KernelPackage);
}

async function init(cwd: string, argv: readonly string[], load: KernelLoader): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { out: (text) => { out += text; }, err: (text) => { err += text; }, cwd, env: {}, stdin: new PassThrough(), isTty: false };
  const args = parseArgs(argv, INIT_FLAGS);

  try {
    const code = await runInit(io, { json: false, color: false }, args, load);

    return { code, out, err };
  } catch (error) {
    return { code: error instanceof CommandError ? 1 : 2, out, err: `${err}${error instanceof Error ? `${(error as { code?: string }).code ?? ''} ${error.message}` : String(error)}` };
  }
}

function sandbox(t: TestContext): string {
  const made = makeProject();

  t.after(made.cleanup);

  return made.dir;
}

test('--no-install with no kernel creates the project, exits 0, and says what is pending', async (t) => {
  const dir = sandbox(t);
  const result = await init(dir, ['demo', '--no-install'], none);

  assert.equal(result.code, 0, result.err);
  assert.ok(existsSync(join(dir, 'demo', 'package.json')));
  assert.ok(existsSync(join(dir, 'demo', 'src', 'participants', 'demo', 'index.mjs')));
  assert.equal(existsSync(join(dir, 'demo', 'brud.config.json')), false);
  assert.match(result.out, /Not finished: brud\.config\.json/u);
  assert.match(result.out, /npm install/u);
  assert.match(result.out, /brud init --finish/u);
});

test('--finish writes only brud.config.json from the installed kernel, then refuses to run twice', async (t) => {
  const dir = sandbox(t);

  await init(dir, ['demo', '--no-install'], none);

  const kernel = fakeKernel(join(dir, 'fake-kernel'), ['b.js', 'a.js', 'readme.txt']);
  const before = readFileSync(join(dir, 'demo', 'package.json'), 'utf8');
  const done = await init(join(dir, 'demo'), ['--finish'], kernel);

  assert.equal(done.code, 0, done.err);

  const config = JSON.parse(readFileSync(join(dir, 'demo', 'brud.config.json'), 'utf8')) as { services: { path: string; official: boolean }[] };

  assert.deepEqual(config.services, [
    { path: 'kernel:serviceModules/a.js', official: true },
    { path: 'kernel:serviceModules/b.js', official: true },
    { path: './src/participants/demo/index.mjs', official: true },
  ]);
  assert.equal(readFileSync(join(dir, 'demo', 'package.json'), 'utf8'), before);

  const again = await init(join(dir, 'demo'), ['--finish'], kernel);

  assert.equal(again.code, 1);
  assert.match(again.err, /INIT_EXISTS/u);
});

test('a normal init with a kernel writes the same config that --finish would', async (t) => {
  const dir = sandbox(t);
  const kernel = fakeKernel(join(dir, 'fake-kernel'), ['x.js']);
  const result = await init(dir, ['demo', '--no-install'], kernel);

  assert.equal(result.code, 0, result.err);
  assert.match(readFileSync(join(dir, 'demo', 'brud.config.json'), 'utf8'), /kernel:serviceModules\/x\.js/u);
  assert.doesNotMatch(result.out, /Not finished/u);
});

test('--finish explains itself when the kernel is missing, the folder is not a project, or flags clash', async (t) => {
  const dir = sandbox(t);

  await init(dir, ['demo', '--no-install'], none);

  const missing = await init(join(dir, 'demo'), ['--finish'], none);

  assert.equal(missing.code, 1);
  assert.match(missing.err, /PACKAGE_NOT_FOUND/u);
  assert.match(missing.err, /npm install/u);
  assert.equal(existsSync(join(dir, 'demo', 'brud.config.json')), false);

  const empty = join(dir, 'empty-folder');

  mkdirSync(empty);

  const notProject = await init(empty, ['--finish'], fakeKernel(join(dir, 'k2'), ['a.js']));

  assert.match(notProject.err, /INIT_NOT_A_PROJECT/u);

  const clash = await init(join(dir, 'demo'), ['--finish', '--kind'], none);

  assert.equal(clash.code, 2);
});

test('a kernel with no hardcore modules is an error, never a broken config', async (t) => {
  const dir = sandbox(t);
  const hollow = fakeKernel(join(dir, 'hollow'), []);
  const result = await init(dir, ['demo', '--no-install'], hollow);

  assert.equal(result.code, 1);
  assert.match(result.err, /INIT_NO_HARDCORE/u);
  assert.equal(existsSync(join(dir, 'demo', 'brud.config.json')), false);

  const finish = await init(join(dir, 'demo'), ['--finish'], hollow);

  assert.match(finish.err, /INIT_NO_HARDCORE/u);
  assert.equal(existsSync(join(dir, 'demo', 'brud.config.json')), false);
});

test('a kernel that is present but will not load is a real error, not "not installed"', async (t) => {
  const dir = sandbox(t);
  const broken: KernelLoader = () => Promise.reject(new SyntaxError('bad kernel build'));
  const result = await init(dir, ['demo', '--no-install'], broken);

  assert.equal(result.code, 2);
  assert.match(result.err, /bad kernel build/u);
});
