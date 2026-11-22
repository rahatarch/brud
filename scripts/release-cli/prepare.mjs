#!/usr/bin/env node
// Step 1 of a CLI release: bump the CLI version and commit. Publishes nothing, tags nothing.
//   npm run release:cli:prepare -- <version> [--dry-run]
// Needs docs/release-notes/cli-v<version>.md to exist already (merge it first).
import { ROOT, parseArgs } from './lib/args.mjs';
import { git, failIfAny, run } from './lib/exec.mjs';
import { TAG_PREFIX, checkCli, checkNotes, loadCli, notesPath, readNotes, tagFor, writeJson } from './lib/cli.mjs';
import { compare, isValid } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const version = args._[0];
const dry = Boolean(args['dry-run']);
const problems = [];

if (!version || !isValid(version)) {
  failIfAny('Usage: npm run release:cli:prepare -- <version>', [`"${version ?? ''}" is not a valid version (x.y.z or x.y.z-beta.1)`]);
}
const cli = loadCli(ROOT);
const current = cli.json.version;
if (compare(version, current) <= 0) problems.push(`${version} must be greater than the current CLI version ${current}`);
if (git(['status', '--porcelain']).stdout.trim()) problems.push('the working tree has uncommitted changes; commit or stash them first');
git(['fetch', 'origin', '--tags', '--quiet']);
const tag = tagFor(version);
if (git(['tag', '--list', tag]).stdout.trim() || git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).stdout.trim()) problems.push(`tag ${tag} already exists`);
const notes = readNotes(ROOT, version);
const priorTags = git(['tag', '--list', `${TAG_PREFIX}*`]).stdout.split('\n').filter(Boolean);
if (notes === null) problems.push(`write and commit the release notes first: ${notesPath(ROOT, version).replace(ROOT, '.')}`);
else problems.push(...checkNotes(notes, version, { first: priorTags.length === 0 }));
failIfAny(`Cannot prepare CLI ${version}:`, problems);

if (dry) {
  console.log(`Dry run: CLI ${current} -> ${version} would update packages/cli/package.json and package-lock.json.`);
  process.exit(0);
}

cli.json.version = version;
writeJson(cli.file, cli.json);
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: ROOT });
const after = checkCli(ROOT, { version });
if (after.length) {
  git(['checkout', '--', '.']);
  failIfAny('The bump left the tree inconsistent, so it was reverted:', after);
}
git(['add', '-A']);
git(['commit', '-m', `release(cli): ${tag}`, '-m', `Bump @brud/cli from ${current} to ${version}.`]);
console.log(`\nCommitted "release(cli): ${tag}".`);
console.log('Next:');
console.log('  1. Push it (or open a pull request) and wait for CI to pass.');
console.log(`  2. Once it is on main: npm run release:cli:tag -- ${version} --push`);
