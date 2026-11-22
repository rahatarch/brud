// Starts `brud run --daemon` in a project, makes one call through it, and stops it.
//   node smoke-daemon.mjs <projectDir>   (HOME/USERPROFILE decide the daemon home)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const cwd = process.argv[2];
const win = process.platform === 'win32';
// On Windows run npx as `node npx-cli.js` with no shell; the npx.cmd shim fails in folders whose path has a space.
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const direct = win && existsSync(npxCli);
const npx = direct ? process.execPath : win ? 'npx.cmd' : 'npx';
const npxArgs = (rest) => (direct ? [npxCli, ...rest] : rest);
const child = spawn(npx, npxArgs(['--no-install', 'brud', 'run', '--daemon']), { cwd, shell: win && !direct, stdio: ['ignore', 'pipe', 'pipe'] });
let seen = '';
const stop = () => {
  try { child.kill(); if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']); } catch { /* already gone */ }
};
const fail = (msg) => { stop(); console.error(msg); process.exit(1); };
const timer = setTimeout(() => fail(`the daemon did not start within 90 s:\n${seen}`), 90_000);
child.on('error', (e) => fail(`could not start the daemon: ${e.message}`));
child.on('exit', (code) => { if (!/daemon at /.test(seen)) fail(`the daemon exited early (${code}):\n${seen}`); });

let called = false;
const onData = (d) => {
  seen += d;
  if (called || !/daemon at /.test(seen)) return;
  called = true;
  clearTimeout(timer);
  // The start-up line can appear a moment before the daemon accepts clients, so retry briefly.
  let r;
  for (let attempt = 1; attempt <= 20; attempt++) {
    r = spawnSync(npx, npxArgs(['--no-install', 'brud', 'call', '--daemon', '--file', 'examples/notes.brud']), { cwd, shell: win && !direct, encoding: 'utf8' });
    if (r.status === 0) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  stop();
  if (r.status !== 0) fail(`brud call --daemon exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  process.stdout.write(r.stdout);
  process.exit(0);
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
