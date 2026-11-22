#!/usr/bin/env node
// Installs a packed participant the way a project would and loads it.
//   node scripts/release-participant/smoke.mjs --dir dist-release-participant [--from-registry]
// Uses the packed tarball by default; --from-registry installs @brud/<name>@version from npm instead.
// The participant's @brud peers (kernel, ...) are installed from the registry at the newest version its
// ranges allow, because a real project has to supply them. Its @brud dependencies come from the registry too,
// so a participant cannot be released before the packages it depends on.
// Not covered yet: booting it in a composition and per-kind conformance (a later increment).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { run } from './lib/exec.mjs';
import { verifySums } from './lib/integrity.mjs';
import { SCOPE, loadParticipant } from './lib/participant.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release-participant');
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const fromRegistry = Boolean(args['from-registry']);
const win = process.platform === 'win32';
const fullName = packages[0].name;
const spec = fromRegistry ? `${fullName}@${version}` : join(dir, packages[0].file);
const peers = loadParticipant(ROOT, fullName.slice(SCOPE.length)).json.peerDependencies ?? {};

const results = [];
const tmpDirs = [];
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

// On Windows npm runs as `node npm-cli.js` with no shell: the npm.cmd shim fails in a folder with a space in its path
// (this test's folder has one, deliberately).
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
function npm(argv, { cwd, env, check = true } = {}) {
  const direct = win && existsSync(npmCli);
  const r = direct
    ? spawnSync(process.execPath, [npmCli, ...argv], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(win ? 'npm.cmd' : 'npm', argv, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: win, maxBuffer: 64 * 1024 * 1024 });
  const out = { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  if (check && out.status !== 0) throw new Error(`npm ${argv.join(' ')} exited ${out.status}\n${`${out.stdout}\n${out.stderr}`.trim().split('\n').slice(-15).join('\n')}`);
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

const work = mkdtempSync(join(tmpdir(), 'brud participant smoke ')); // the space is deliberate
const home = join(work, 'home');
tmpDirs.push(work);
mkdirSync(home, { recursive: true });
const env = { HOME: home, USERPROFILE: home, TMPDIR: work, TEMP: work, TMP: work, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
console.log(`Participant smoke test: ${fromRegistry ? 'registry' : 'tarball'} ${fullName} ${version} on ${process.platform}-${process.arch}, Node ${process.versions.node}`);

if (!fromRegistry) step('SHA256SUMS still matches the file', () => {
  const p = verifySums(dir);
  if (p.length) throw new Error(p.join('\n'));
});

let peerSpecs = [];
step('resolve the @brud peers the participant needs', () => {
  peerSpecs = Object.entries(peers).filter(([n]) => n.startsWith(SCOPE)).map(([n, r]) => resolvePeer(n, r));
  return peerSpecs.join(', ') || 'none';
});

const app = join(work, 'app');
step('install into an empty project (with its peers and dependencies from npm)', () => {
  mkdirSync(app, { recursive: true });
  npm(['init', '-y'], { cwd: app, env });
  npm(['install', spec, ...peerSpecs], { cwd: app, env });
  const v = JSON.parse(readFileSync(join(app, 'node_modules', ...fullName.split('/'), 'package.json'), 'utf8')).version;
  if (v !== version) throw new Error(`installed ${v}, expected ${version}`);
});
step('the package loads and exports something', () => {
  writeFileSync(join(app, 'load.mjs'), "const m = await import(process.argv[2]);\nconst keys = Object.keys(m);\nif (keys.length === 0) { console.error('the package exports nothing'); process.exit(1); }\nconsole.log(`${keys.length} exports`);\n");
  const r = spawnSync(process.execPath, ['load.mjs', fullName], { cwd: app, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
});
step('npm finds no missing or invalid dependencies', () => {
  npm(['ls', '--omit=dev'], { cwd: app, env });
});

finish();
