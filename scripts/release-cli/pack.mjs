#!/usr/bin/env node
// Packs @brud/cli once, checks the tarball, and writes SHA256SUMS and a manifest.
//   node scripts/release-cli/pack.mjs [--out dir]
//   node scripts/release-cli/pack.mjs --from-registry <version> [--out dir]   (adopt what is on npm)
// Build first: npm run build --workspace @brud/cli
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { failIfAny, run } from './lib/exec.mjs';
import { CLI_NAME, loadCli } from './lib/cli.mjs';
import { sha256Hex, sriSha512, verifySums, writeSums } from './lib/integrity.mjs';

// --from-registry takes a version here (smoke.mjs uses it as a plain flag, so it is not in the default boolean list).
const args = parseArgs(process.argv.slice(2), ['ci', 'push', 'dry-run', 'sign']);
const out = resolve(args.out ?? join(ROOT, 'dist-release-cli'));
const fromRegistry = args['from-registry'];
const cli = loadCli(ROOT);
const version = fromRegistry ?? cli.json.version;
const file = `${CLI_NAME.replace('@', '').replace('/', '-')}-${version}.tgz`;

const FORBIDDEN = [
  [/^package\/(?!templates\/).*\.test\.[cm]?[jt]s$/, 'a test file (scaffold templates under templates/ may ship tests)'],
  [/\.map$/, 'a source map'],
  [/(^|\/)\.env/, 'an env file'],
  [/\.internal_docs/, 'the internal ledger'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/(^|\/)\.git(\/|$)/, 'git data'],
  [/(^|\/)src\//, 'TypeScript sources'],
];
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'dist/cli.js', 'dist/index.js', 'runtime/quickjs.wasm'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (fromRegistry) {
  run('npm', ['pack', `${CLI_NAME}@${version}`, '--pack-destination', out], { cwd: out });
} else {
  run('npm', ['pack', '--pack-destination', out], { cwd: join(ROOT, cli.dir) });
}
const path = join(out, file);
const files = run('tar', ['-tzf', path]).stdout.split('\n').map((l) => l.trim()).filter(Boolean);
const has = (p) => files.includes(`package/${p}`);
const problems = [];
for (const r of REQUIRED) if (!has(r)) problems.push(`${CLI_NAME}: ${r} is missing from the tarball`);
if (!files.some((f) => f.startsWith('package/templates/'))) problems.push(`${CLI_NAME}: the templates folder is missing from the tarball`);
for (const f of files) for (const [re, what] of FORBIDDEN) if (re.test(f)) problems.push(`${CLI_NAME}: tarball contains ${what} (${f})`);
const integrity = sriSha512(path);
if (fromRegistry) {
  const published = run('npm', ['view', `${CLI_NAME}@${version}`, 'dist.integrity', '--prefer-online']).stdout.trim();
  if (integrity !== published) problems.push(`${CLI_NAME}: downloaded tarball does not match the registry integrity`);
}
failIfAny('The tarball failed its checks:', problems);

const entry = { name: CLI_NAME, version, file, sha256: sha256Hex(path), integrity, size: statSync(path).size, fileCount: files.length };
console.log(`  packed ${file} (${(entry.size / 1024).toFixed(1)} kB, ${files.length} files)`);
writeSums(out, [file]);
writeFileSync(join(out, 'release-manifest.json'), `${JSON.stringify({ version, packages: [entry] }, null, 2)}\n`);
failIfAny('SHA256SUMS does not verify:', verifySums(out));
console.log(`Packed ${CLI_NAME} ${version} into ${out}`);
