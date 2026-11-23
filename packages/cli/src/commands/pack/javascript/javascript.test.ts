import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { asHost, hardcoreModulePaths, withScratchKernel, type KernelPackage } from '../../../composition/load.js';
import { loadPackage } from '../../../core/project.js';
import { brud, linkEsbuild, makeProject } from '../../../testing/helpers.js';

const MiB = 1024 * 1024;
const LIMITS = { fuel: 3_000_000_000, maxMemoryBytes: 64 * MiB, deadlineMs: 20_000 };

const HANDLER = `
export default function handler(request) {
  switch (request.method) {
    case 'add': return request.args[0] + request.args[1];
    case 'who': return { official: request.caller.official, exposure: request.exposure };
    case 'boom': throw Object.assign(new Error('nope'), { code: 'MY_CODE' });
    case 'outside': return brud.call('nobody.home', 'x', []);
    case 'world': return [typeof process, typeof globalThis.require, typeof fetch, typeof globalThis.Buffer];
    case 'spin': for (;;) { /* runs until the cage's fuel ends */ }
    default: return null;
  }
}
`;

function guest(t: TestContext, files: Record<string, string>, source = 'src/index.js', extra: Record<string, unknown> = {}, limits: object = LIMITS): { project: string; dir: string } {
  const made = makeProject();

  t.after(made.cleanup);
  linkEsbuild(made.dir);

  const dir = join(made.dir, 'guest');

  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }

  writeFileSync(join(dir, 'brud.participant.src.json'), JSON.stringify({
    id: 'acme.js',
    manifest: { requests: { capabilities: [] }, exposures: [{ name: 'acme.js.math', version: 1, scope: 'any', policy: { policyVersion: 2, capabilities: ['js:use'] } }] },
    limits,
    guest: { source, ...extra },
  }));

  return { project: made.dir, dir };
}

/** Boots the packed package (not official) in a scratch kernel and runs `use` as a host caller. */
async function withPackage<T>(project: string, dir: string, use: (api: Record<string, (...args: unknown[]) => unknown>) => Promise<T>): Promise<T> {
  const kernel = (await loadPackage('@brud/kernel', project)) as KernelPackage;
  const scratch = mkdtempSync(join(tmpdir(), 'brud-js-test-'));
  const config = join(scratch, 'brud.config.json');

  writeFileSync(config, JSON.stringify({ services: [...hardcoreModulePaths(kernel.root).map((path) => ({ path, official: true })), { path: join(dir, 'dist', 'brud.participant.json'), official: false }] }));

  return withScratchKernel(kernel, config, {}, (booted) => asHost(kernel, booted, ['js:use'], (registry) => use(registry.resolve('acme.js.math') as Record<string, (...args: unknown[]) => unknown>)));
}

async function pack(t: TestContext, files: Record<string, string>, source?: string, extra?: Record<string, unknown>, limits?: object): Promise<{ project: string; dir: string }> {
  const built = guest(t, files, source, extra, limits);
  const result = await brud(built.dir, ['pack', '--verify']);

  assert.equal(result.code, 0, result.out + result.err);

  return built;
}

test('a JavaScript guest packs, hashes and boots, and runs inside the cage', async (t) => {
  const { project, dir } = await pack(t, { 'src/index.js': HANDLER });
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'brud.participant.json'), 'utf8')) as { cage: { sha256: string; limits: unknown } };

  assert.equal(manifest.cage.sha256, createHash('sha256').update(readFileSync(join(dir, 'dist', 'participant.wasm'))).digest('hex'));
  assert.deepEqual(manifest.cage.limits, LIMITS);

  await withPackage(project, dir, async (api) => {
    assert.equal(api.add?.(2, 3), 5);
    assert.deepEqual(api.who?.(), { official: false, exposure: 'acme.js.math@1' });
    assert.equal(api.nothing?.(), null);
    assert.deepEqual(api.world?.(), ['undefined', 'undefined', 'undefined', 'undefined']);
  });
});

test('a guest error keeps its code, and brud.call reports a refused routed call', async (t) => {
  const { project, dir } = await pack(t, { 'src/index.js': HANDLER });

  await withPackage(project, dir, async (api) => {
    assert.throws(() => api.boom?.(), (error: Error & { guestCode?: string }) => error.guestCode === 'MY_CODE' && /nope/u.test(error.message));
    assert.throws(() => api.outside?.(), (error: Error & { guestCode?: string }) => error.guestCode === 'WASM_CAGE_ROUTED_NOT_FOUND');
  });
});

test('a runaway guest is stopped by the cage fuel limit and the kernel stays up', async (t) => {
  const { project, dir } = await pack(t, { 'src/index.js': HANDLER }, 'src/index.js', {}, { ...LIMITS, fuel: 500_000_000 });

  await withPackage(project, dir, async (api) => {
    assert.throws(() => api.spin?.(), (error: Error & { code?: string; reason?: string }) => error.code === 'WASM_CAGE_GUEST_FAILED' && error.reason === 'CAGE_FUEL_LIMIT' && !/backtrace|0x[0-9a-f]+/u.test(error.message) && error.message.length < 120);
    assert.equal(api.add?.(1, 1), 2);
  });
});

test('a TypeScript guest is bundled with its imports and its types removed', async (t) => {
  const { project, dir } = await pack(t, {
    'src/helper.ts': 'export const double = (value: number): number => value * 2;\n',
    'src/index.ts': "import { double } from './helper';\ninterface Request { readonly method: string; readonly args: number[] }\nexport function handler(request: Request): number { return double(request.args[0] ?? 0); }\n",
  }, 'src/index.ts', { language: 'javascript' });

  await withPackage(project, dir, async (api) => {
    assert.equal(api.twice?.(21), 42);
  });
});

test('pack explains JavaScript build problems and writes no package when they happen', async (t) => {
  const node = guest(t, { 'src/index.js': "import { readFileSync } from 'node:fs';\nexport default () => readFileSync;\n" });

  assert.match((await brud(node.dir, ['pack'])).err, /PACK_COMPILE_FAILED.*"node:fs" is a Node module, and the cage has no Node modules\. Remove the import/u);

  const bare = guest(t, { 'src/index.js': "import { join } from 'path/posix';\nexport default () => join;\n" });

  assert.match((await brud(bare.dir, ['pack'])).err, /"path\/posix" is a Node module/u);

  const missing = guest(t, { 'src/index.js': "import x from './nowhere.js';\nexport default () => x;\n" });

  assert.doesNotMatch((await brud(missing.dir, ['pack'])).err, /Node module/u);

  const syntax = guest(t, { 'src/index.js': 'export default function ( {\n' });

  assert.match((await brud(syntax.dir, ['pack'])).err, /PACK_COMPILE_FAILED.*index\.js:\d+/u);

  const big = guest(t, { 'src/index.js': `export default () => "${'a'.repeat(300_000)}";\n` });

  assert.match((await brud(big.dir, ['pack'])).err, /PACK_SCRIPT_TOO_LARGE/u);
});

test('a low fuel budget gets a warning that explains the interpreter cost', async (t) => {
  const built = guest(t, { 'src/index.js': 'export default () => 1;\n' }, 'src/index.js', {}, { ...LIMITS, fuel: 1_000_000 });
  const result = await brud(built.dir, ['pack']);

  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /limits\.fuel 1000000 is low for JavaScript/u);
});
