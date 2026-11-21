#!/usr/bin/env node
// Installs the release into empty folders and boots it, the way a user would.
//   node scripts/release/smoke.mjs --dir dist-release [--from-registry]
// Uses the packed tarballs by default; --from-registry installs @brud/*@version from npm instead.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { run } from './lib/exec.mjs';
import { verifySums } from './lib/integrity.mjs';

const args = parseArgs(process.argv.slice(2), ['from-registry']);
const dir = resolve(args.dir ?? 'dist-release');
const manifest = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const { version, packages } = manifest;
const fromRegistry = Boolean(args['from-registry']);
const cli = readdirSync(join(dir, 'test-only')).find((f) => f.endsWith('.tgz'));
if (!cli) throw new Error('the CLI test driver tarball is missing');
const cliTarball = join(dir, 'test-only', cli);

const results = [];
const step = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true });
    console.log(`  [ok] ${name}${detail ? `: ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.error(`  [x] ${name}\n${String(e.message).split('\n').map((l) => `      ${l}`).join('\n')}`);
    finish();
  }
};
function finish() {
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad === 0 ? `\nSmoke test passed (${results.length} checks).` : `\nSmoke test FAILED (${bad} of ${results.length}).`);
  process.exit(bad === 0 ? 0 : 1);
}

const work = mkdtempSync(join(tmpdir(), 'brud-smoke-'));
const home = join(work, 'home');
// A private TMPDIR keeps this daemon's socket and lock away from any other daemon on the machine.
// Unix socket paths are limited to about 100 bytes (macOS runners have long temp folders),
// so on macOS and Linux the scratch folder is created under /tmp, where the path stays short.
const scratch = process.platform === 'win32' ? join(work, 'tmp') : mkdtempSync('/tmp/bs-');
mkdirSync(scratch, { recursive: true });
const env = { HOME: home, USERPROFILE: home, TMPDIR: scratch, TEMP: scratch, TMP: scratch, npm_config_update_notifier: 'false', npm_config_fund: 'false' };
const installSpecs = fromRegistry
  ? packages.map((p) => `${p.name}@${version}`)
  : packages.map((p) => join(dir, p.file));

console.log(`Smoke test: ${fromRegistry ? 'registry' : 'tarballs'} ${version} on ${process.platform}-${process.arch}, Node ${process.versions.node}`);

if (!fromRegistry) step('SHA256SUMS still matches the files', () => {
  const p = verifySums(dir);
  if (p.length) throw new Error(p.join('\n'));
});

const app = join(work, 'app');
step('install into an empty project', () => {
  run('node', ['-e', `require('fs').mkdirSync(${JSON.stringify(app)}, { recursive: true })`]);
  run('npm', ['init', '-y'], { cwd: app, env });
  run('npm', ['install', ...installSpecs, cliTarball], { cwd: app, env });
});

step('installed versions are all the release version', () => {
  for (const p of packages) {
    const v = JSON.parse(readFileSync(join(app, 'node_modules', ...p.name.split('/'), 'package.json'), 'utf8')).version;
    if (v !== version) throw new Error(`${p.name} is ${v}, expected ${version}`);
  }
  return packages.map((p) => p.name.replace('@brud/', '')).join(', ');
});

step('every cage binary matches its pinned digest', () => {
  const kernel = join(app, 'node_modules', '@brud', 'kernel');
  const probe = `
    const { createHash } = require('node:crypto');
    const { readFileSync, readdirSync } = require('node:fs');
    const { join } = require('node:path');
    import(${JSON.stringify(pathToFileURL(join(kernel, 'dist', 'services', 'WasmCage', 'src', 'nativeDigests.js')).href)}).then((m) => {
      const table = new Map(m.WASM_CAGE_NATIVE_DIGESTS);
      const nativeDir = join(${JSON.stringify(kernel)}, 'services', 'WasmCage', 'native');
      let bad = 0;
      for (const f of readdirSync(nativeDir)) {
        const key = f.replace('brud-wasm-cage.', '').replace('.node', '');
        const sha = createHash('sha256').update(readFileSync(join(nativeDir, f))).digest('hex');
        if (table.get(key) !== sha) { bad++; console.error('MISMATCH ' + key); }
      }
      console.log(table.size + ' pinned, ' + bad + ' mismatched');
      process.exit(bad === 0 && table.size === 5 ? 0 : 1);
    });`;
  return run('node', ['-e', probe], { cwd: app }).stdout.trim();
});

const demo = join(app, 'demo');
const brud = (a, opts = {}) => run('npx', ['--no-install', 'brud', ...a], { cwd: opts.cwd ?? demo, env, check: opts.check ?? true });

step('scaffold a project with the CLI', () => {
  run('npx', ['--no-install', 'brud', 'init', 'demo', '--kind', '--no-install'], { cwd: app, env });
  run('npm', ['install', ...installSpecs, cliTarball], { cwd: demo, env });
});
step('brud doctor reports no problems', () => {
  const r = brud(['doctor']);
  if (!/No problems found/.test(r.stdout)) throw new Error(r.stdout);
});
step('the scaffolded participant passes its tests on the real kernel', () => {
  run('npm', ['test'], { cwd: demo, env });
});
step('brud check boots the composition', () => {
  const r = brud(['check']);
  if (!/No problems found/.test(r.stdout)) throw new Error(r.stdout);
});

const assertRouted = (stdout) => {
  const result = JSON.parse(stdout);
  const ok = result.status === 'success' && result.operations.length === 3 &&
    result.operations.every((o) => o.status === 'success');
  if (!ok) throw new Error(stdout.slice(0, 600));
};
step('brud call routes three operations (embedded kernel)', () => {
  assertRouted(brud(['call', '--file', 'examples/notes.brud']).stdout);
});

step('the daemon starts and serves a call', () => {
  const r = run('node', [join(dirname(fileURLToPath(import.meta.url)), 'smoke-daemon.mjs'), demo], { env, check: false });
  if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
  assertRouted(r.stdout);
});

for (const d of [work, scratch]) {
  try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
}
finish();
