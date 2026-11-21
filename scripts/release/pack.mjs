#!/usr/bin/env node
// Packs the core packages once, checks the tarballs, and writes SHA256SUMS and a manifest.
//   node scripts/release/pack.mjs [--out dir] [--skip-cli]
//   node scripts/release/pack.mjs --from-registry <version> [--out dir]   (adopt what is on npm)
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { failIfAny, run } from './lib/exec.mjs';
import { loadCore, publishOrder } from './lib/packages.mjs';
import { sha256Hex, sriSha512, verifySums, writeSums } from './lib/integrity.mjs';

const args = parseArgs(process.argv.slice(2));
const out = resolve(args.out ?? join(ROOT, 'dist-release'));
const fromRegistry = args['from-registry'];
const core = publishOrder(loadCore(ROOT));
const version = fromRegistry ?? core[0].json.version;

const fileName = (name, v) => `${name.replace('@', '').replace('/', '-')}-${v}.tgz`;
const FORBIDDEN = [
  [/\.test\.[cm]?[jt]s$/, 'a test file'],
  [/\.map$/, 'a source map'],
  [/(^|\/)\.env/, 'an env file'],
  [/\.internal_docs/, 'the internal ledger'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/(^|\/)\.git(\/|$)/, 'git data'],
];

function listTarball(file) {
  return run('tar', ['-tzf', file]).stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function checkTarball(pkg, file) {
  const problems = [];
  const files = listTarball(file);
  const has = (p) => files.includes(`package/${p}`);
  for (const required of ['package.json', 'README.md', 'LICENSE']) {
    if (!has(required)) problems.push(`${pkg.json.name}: ${required} is missing from the tarball`);
  }
  const main = (pkg.json.main ?? '').replace(/^\.\//, '');
  if (main && !has(main)) problems.push(`${pkg.json.name}: main (${main}) is missing from the tarball`);
  for (const f of files) {
    for (const [re, what] of FORBIDDEN) {
      if (re.test(f)) problems.push(`${pkg.json.name}: tarball contains ${what} (${f})`);
    }
  }
  if (pkg.json.name === '@brud/kernel') {
    const natives = files.filter((f) => /services\/WasmCage\/native\/.+\.node$/.test(f));
    if (natives.length !== 5) problems.push(`@brud/kernel: expected 5 cage binaries, found ${natives.length}`);
  }
  return { problems, files };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const problems = [];
const entries = [];
for (const pkg of core) {
  const name = pkg.json.name;
  const file = fileName(name, version);
  if (fromRegistry) {
    run('npm', ['pack', `${name}@${version}`, '--pack-destination', out], { cwd: out });
    const published = run('npm', ['view', `${name}@${version}`, 'dist.integrity', '--prefer-online']).stdout.trim();
    if (sriSha512(join(out, file)) !== published) problems.push(`${name}: downloaded tarball does not match the registry integrity`);
  } else {
    run('npm', ['pack', '--pack-destination', out], { cwd: join(ROOT, pkg.dir) });
  }
  const path = join(out, file);
  const checked = checkTarball(pkg, path);
  problems.push(...checked.problems);
  entries.push({
    name,
    version,
    file,
    sha256: sha256Hex(path),
    integrity: sriSha512(path),
    size: statSync(path).size,
    fileCount: checked.files.length,
  });
  console.log(`  packed ${file} (${(statSync(path).size / 1024).toFixed(1)} kB, ${checked.files.length} files)`);
}

if (!args['skip-cli']) {
  const cliDir = join(ROOT, 'packages', 'cli');
  const testOnly = join(out, 'test-only');
  mkdirSync(testOnly, { recursive: true });
  run('npm', ['pack', '--pack-destination', testOnly], { cwd: cliDir });
  console.log('  packed the CLI tarball (test driver only, never published)');
}

failIfAny('The tarballs failed their checks:', problems);

writeSums(out, entries.map((e) => e.file));
writeFileSync(join(out, 'release-manifest.json'), `${JSON.stringify({ version, packages: entries }, null, 2)}\n`);
failIfAny('SHA256SUMS does not verify:', verifySums(out));
console.log(`Packed ${entries.length} packages for ${version} into ${out}`);
