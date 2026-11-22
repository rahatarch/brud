#!/usr/bin/env node
// Packs one participant once, checks the tarball, and writes SHA256SUMS and a manifest.
//   node scripts/release-participant/pack.mjs --name <name> [--out dir]
//   node scripts/release-participant/pack.mjs --name <name> --from-registry <version> [--out dir]   (adopt what is on npm)
// Build first: npm run build:services (the services build as one project).
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { failIfAny, run } from './lib/exec.mjs';
import { loadParticipant } from './lib/participant.mjs';
import { sha256Hex, sriSha512, verifySums, writeSums } from './lib/integrity.mjs';

// --from-registry takes a version here, so it is not in the boolean list.
const args = parseArgs(process.argv.slice(2), ['ci', 'push', 'dry-run', 'sign']);
if (!args.name) failIfAny('Usage: pack.mjs --name <name> [--from-registry <version>] [--out dir]', ['--name is required']);
const out = resolve(args.out ?? join(ROOT, 'dist-release-participant'));
const fromRegistry = args['from-registry'];
const pkg = loadParticipant(ROOT, args.name);
const fullName = pkg.json.name;
const version = fromRegistry ?? pkg.json.version;
const file = `${fullName.replace('@', '').replace('/', '-')}-${version}.tgz`;

const FORBIDDEN = [
  [/\.test\.[cm]?[jt]s$/, 'a test file'],
  [/\.map$/, 'a source map'],
  [/(^|\/)\.env/, 'an env file'],
  [/\.internal_docs/, 'the internal ledger'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/(^|\/)\.git(\/|$)/, 'git data'],
  [/(^|\/)src\//, 'TypeScript sources'],
];
const main = String(pkg.json.main ?? 'dist/index.js').replace(/^\.\//, '');
const REQUIRED = ['package.json', 'README.md', 'LICENSE', main];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (fromRegistry) run('npm', ['pack', `${fullName}@${version}`, '--pack-destination', out], { cwd: out });
else run('npm', ['pack', '--pack-destination', out], { cwd: join(ROOT, pkg.dir) });
const path = join(out, file);
const files = run('tar', ['-tzf', path]).stdout.split('\n').map((l) => l.trim()).filter(Boolean);
const problems = [];
for (const r of REQUIRED) if (!files.includes(`package/${r}`)) problems.push(`${fullName}: ${r} is missing from the tarball`);
for (const f of files) {
  if (f !== 'package/package.json' && !/^package\/(dist\/|README\.md$|LICENSE$|CHANGELOG\.md$)/.test(f)) problems.push(`${fullName}: unexpected file in the tarball (${f})`);
  for (const [re, what] of FORBIDDEN) if (re.test(f)) problems.push(`${fullName}: tarball contains ${what} (${f})`);
}
const integrity = sriSha512(path);
if (fromRegistry) {
  const published = run('npm', ['view', `${fullName}@${version}`, 'dist.integrity', '--prefer-online']).stdout.trim();
  if (integrity !== published) problems.push(`${fullName}: downloaded tarball does not match the registry integrity`);
}
failIfAny('The tarball failed its checks:', problems);

const entry = { name: fullName, version, file, sha256: sha256Hex(path), integrity, size: statSync(path).size, fileCount: files.length };
console.log(`  packed ${file} (${(entry.size / 1024).toFixed(1)} kB, ${files.length} files)`);
writeSums(out, [file]);
writeFileSync(join(out, 'release-manifest.json'), `${JSON.stringify({ version, packages: [entry] }, null, 2)}\n`);
failIfAny('SHA256SUMS does not verify:', verifySums(out));
console.log(`Packed ${fullName} ${version} into ${out}`);
