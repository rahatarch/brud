#!/usr/bin/env node
// Installs the CLI the way a user would (globally, and into a project) and runs it.
//   node scripts/release-cli/smoke.mjs --dir dist-release-cli [--from-registry]
// Uses the packed tarball by default; --from-registry installs @brud/cli@version from npm instead.
// The CLI's optional peers (kernel, sdk, daemon) are installed from the registry at the newest
// version its peer ranges allow, because a real project has to supply them.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, parseArgs } from './lib/args.mjs';
import { run } from './lib/exec.mjs';
import { verifySums } from './lib/integrity.mjs';
import { CORE_PEERS, loadCli } from './lib/cli.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release-cli');
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const fromRegistry = Boolean(args['from-registry']);
const win = process.platform === 'win32';
const cliSpec = fromRegistry ? `@brud/cli@${version}` : join(dir, packages[0].file);
const peers = loadCli(ROOT).json.peerDependencies ?? {};

const results = [];
const tmpDirs = []; // removed on every exit, passing or failing
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
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad === 0 ? `\nSmoke test passed (${results.length} checks).` : `\nSmoke test FAILED (${bad} of ${results.length}).`);
  process.exit(bad === 0 ? 0 : 1);
}

// Run one command line through the shell with every part quoted, so paths with spaces work on all systems.
const q = (s) => (win ? `"${String(s).replace(/"/g, '\\"')}"` : `'${String(s).replace(/'/g, `'\\''`)}'`);
// On Windows npm is started as `node npm-cli.js`, with no shell: the npm.cmd shim cannot find npm when the
// working folder has a space in its name (the smoke test's folder does, deliberately).
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
function sh(parts, { cwd, env, check = true } = {}) {
  const direct = win && parts[0] === 'npm' && existsSync(npmCli);
  const r = direct
    ? spawnSync(process.execPath, [npmCli, ...parts.slice(1)], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(parts.map(q).join(' '), { cwd, env: { ...process.env, ...env }, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  if (check && out.status !== 0) throw new Error(`${parts.join(' ')} exited ${out.status}\n${`${out.stdout}\n${out.stderr}`.trim().split('\n').slice(-15).join('\n')}`);
  return out;
}

/** Newest published version of `name` that a caret or exact range allows. Avoids passing `^` through cmd.exe. */
function resolvePeer(name, range) {
  const all = JSON.parse(run('npm', ['view', name, 'versions', '--json', '--prefer-online']).stdout);
  const list = Array.isArray(all) ? all : [all];
  const num = (v) => v.split('-')[0].split('.').map(Number);
  const cmp = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const m = /^(\^)?(\d+\.\d+\.\d+)$/.exec(range);
  if (!m) throw new Error(`${name}: unsupported peer range "${range}" (use an exact or caret range)`);
  const base = num(m[2]);
  const ok = (v) => {
    if (v.includes('-')) return false;
    if (!m[1]) return v === m[2];
    const n = num(v);
    if (cmp(v, m[2]) < 0) return false;
    if (base[0] > 0) return n[0] === base[0];
    if (base[1] > 0) return n[0] === 0 && n[1] === base[1];
    return n[0] === 0 && n[1] === 0 && n[2] === base[2];
  };
  const match = list.filter(ok).sort(cmp).pop();
  if (!match) throw new Error(`no published ${name} satisfies ${range}`);
  return `${name}@${match}`;
}

const work = mkdtempSync(join(tmpdir(), 'brud cli smoke ')); // the space is deliberate
const home = join(work, 'home');
// Unix socket paths are limited to about 100 bytes, so the daemon's scratch folder lives under /tmp there.
const scratch = win ? join(work, 'tmp') : mkdtempSync('/tmp/bs-');
tmpDirs.push(work, scratch);
mkdirSync(scratch, { recursive: true });
mkdirSync(home, { recursive: true });
const env = { HOME: home, USERPROFILE: home, TMPDIR: scratch, TEMP: scratch, TMP: scratch, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };

console.log(`CLI smoke test: ${fromRegistry ? 'registry' : 'tarball'} ${version} on ${process.platform}-${process.arch}, Node ${process.versions.node}`);

if (!fromRegistry) step('SHA256SUMS still matches the file', () => {
  const p = verifySums(dir);
  if (p.length) throw new Error(p.join('\n'));
});

let peerSpecs = [];
step('resolve the peer packages the CLI needs', () => {
  peerSpecs = CORE_PEERS.map((n) => resolvePeer(n, peers[n] ?? (() => { throw new Error(`${n} is not a peer of the CLI`); })()));
  return peerSpecs.join(', ');
});

// 1. Global install: the way most people will install it.
const prefix = join(work, 'global prefix');
const brud = win ? join(prefix, 'brud.cmd') : join(prefix, 'bin', 'brud');
step('npm install -g puts a working `brud` command in place', () => {
  mkdirSync(prefix, { recursive: true });
  sh(['npm', 'install', '-g', '--prefix', prefix, cliSpec], { cwd: work, env });
  if (!existsSync(brud)) throw new Error(`the brud command was not created at ${brud}`);
});
step('`brud --version` prints the release version', () => {
  const r = sh([brud, '--version'], { cwd: work, env });
  if (!r.stdout.includes(version)) throw new Error(`expected ${version}, got: ${r.stdout.trim()}`);
  return r.stdout.trim();
});
step('`brud --help` works', () => {
  const r = sh([brud, '--help'], { cwd: work, env });
  if (!/doctor/.test(r.stdout)) throw new Error(r.stdout.slice(0, 400));
});
// Commands that need the kernel (doctor, check, call, run) are not run globally: kernel, sdk and daemon are
// optional peers, so a global install has none of them. `init --no-install` must still work from nothing,
// so it is checked: it creates the project, exits 0, and leaves brud.config.json for `init --finish`.
step('globally installed `brud init --no-install` creates a project from nothing', () => {
  const r = sh([brud, 'init', 'global-demo', '--kind', '--no-install'], { cwd: work, env });
  if (!existsSync(join(work, 'global-demo', 'package.json'))) throw new Error('global-demo/package.json was not created');
  if (existsSync(join(work, 'global-demo', 'brud.config.json'))) throw new Error('brud.config.json should wait for the kernel');
  if (!/init --finish/.test(r.stdout)) throw new Error(`the next steps were not printed:\n${r.stdout}`);
});

// 2. Project install: the CLI as a development dependency, with kernel, sdk and daemon beside it.
const app = join(work, 'app');
const bruds = (a, cwd) => sh(['npx', '--no-install', 'brud', ...a], { cwd, env });
step('install into an empty project', () => {
  mkdirSync(app, { recursive: true });
  sh(['npm', 'init', '-y'], { cwd: app, env });
  sh(['npm', 'install', cliSpec, ...peerSpecs], { cwd: app, env });
  const v = JSON.parse(readFileSync(join(app, 'node_modules', '@brud', 'cli', 'package.json'), 'utf8')).version;
  if (v !== version) throw new Error(`installed CLI is ${v}, expected ${version}`);
});
const demo = join(app, 'demo');
step('scaffold a project with the CLI', () => {
  bruds(['init', 'demo', '--kind', '--no-install'], app);
  sh(['npm', 'install', cliSpec, ...peerSpecs], { cwd: demo, env });
});
step('brud doctor reports no problems', () => {
  const r = bruds(['doctor'], demo);
  if (!/No problems found/.test(r.stdout)) throw new Error(r.stdout);
});
step('the scaffolded participant passes its tests on the real kernel', () => {
  sh(['npm', 'test'], { cwd: demo, env });
});
step('brud check boots the composition', () => {
  const r = bruds(['check'], demo);
  if (!/No problems found/.test(r.stdout)) throw new Error(r.stdout);
});
const assertRouted = (stdout) => {
  const result = JSON.parse(stdout);
  const ok = result.status === 'success' && result.operations.length === 3 && result.operations.every((o) => o.status === 'success');
  if (!ok) throw new Error(stdout.slice(0, 600));
};
step('brud call routes three operations (embedded kernel)', () => {
  assertRouted(bruds(['call', '--file', 'examples/notes.brud'], demo).stdout);
});
step('the daemon starts and serves a call', () => {
  const r = run('node', [join(dirname(fileURLToPath(import.meta.url)), 'smoke-daemon.mjs'), demo], { env, check: false });
  if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
  assertRouted(r.stdout);
});

finish();
