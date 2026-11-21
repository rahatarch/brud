#!/usr/bin/env node
// Step 1 of a release: bump every version and commit. Publishes nothing, tags nothing.
//   npm run release:prepare -- <version> [--dry-run]
// Needs docs/release-notes/v<version>.md to exist already (merge it first).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { git, failIfAny, run } from './lib/exec.mjs';
import { CONTRACT_FILE, bumpManifest, checkVersions, loadCore, loadWorkspaceManifests, updateContract, writeJson } from './lib/packages.mjs';
import { checkNotes, notesPath, readNotes } from './lib/notes.mjs';
import { compare, isValid } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const version = args._[0];
const dry = Boolean(args['dry-run']);
const problems = [];

if (!version || !isValid(version)) {
  failIfAny('Usage: npm run release:prepare -- <version>', [`"${version ?? ''}" is not a valid version (x.y.z or x.y.z-beta.1)`]);
}
const core = loadCore(ROOT);
const current = core[0].json.version;
if (compare(version, current) <= 0) problems.push(`${version} must be greater than the current version ${current}`);

if (git(['status', '--porcelain']).stdout.trim()) problems.push('the working tree has uncommitted changes; commit or stash them first');
git(['fetch', 'origin', '--tags', '--quiet']);
const tagTaken = git(['tag', '--list', `v${version}`]).stdout.trim() ||
  git(['ls-remote', '--tags', 'origin', `refs/tags/v${version}`]).stdout.trim();
if (tagTaken) problems.push(`tag v${version} already exists`);

const notes = readNotes(ROOT, version);
const priorTags = git(['tag', '--list', 'v*']).stdout.split('\n').filter(Boolean);
if (notes === null) problems.push(`write and commit the release notes first: ${notesPath(ROOT, version).replace(ROOT, '.')}`);
else problems.push(...checkNotes(notes, version, { first: priorTags.length === 0 }));

failIfAny(`Cannot prepare ${version}:`, problems);

if (dry) {
  console.log(`Dry run: ${current} -> ${version} would update ${core.length} core packages, every internal range, ${CONTRACT_FILE}, and package-lock.json.`);
  process.exit(0);
}

const coreNames = new Set(core.map((p) => p.json.name));
for (const m of loadWorkspaceManifests(ROOT)) {
  const before = JSON.stringify(m.json);
  bumpManifest(m.json, version, coreNames);
  if (JSON.stringify(m.json) !== before) writeJson(m.file, m.json);
}
const contract = join(ROOT, CONTRACT_FILE);
writeFileSync(contract, updateContract(readFileSync(contract, 'utf8'), version));
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: ROOT });

const after = checkVersions(ROOT, { version });
if (after.length) {
  git(['checkout', '--', '.']);
  failIfAny('The bump left the tree inconsistent, so it was reverted:', after);
}

git(['add', '-A']);
git(['commit', '-m', `release: v${version}`, '-m', `Bump the BrudOS packages (protocol, kernel, sdk, daemon) from ${current} to ${version}.`]);
console.log(`\nCommitted "release: v${version}".`);
console.log('Next:');
console.log('  1. Push it (or open a pull request) and wait for CI to pass.');
console.log(`  2. Once it is on main: npm run release:tag -- ${version} --push`);
