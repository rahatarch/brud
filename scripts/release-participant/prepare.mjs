#!/usr/bin/env node
// Step 1 of a participant release: bump the version, turn "*" ranges into real ones, commit. Publishes and tags nothing.
//   npm run release:participant:prepare -- <name> <version> [--dry-run]
// Needs docs/release-notes/<name>@<version>.md, README.md and LICENSE in the package (merge them first).
import { ROOT, parseArgs } from './lib/args.mjs';
import { git, failIfAny, run } from './lib/exec.mjs';
import { SCOPE, checkNotes, checkParticipant, listPackages, loadParticipant, notesPath, readNotes, tagFor, writeJson } from './lib/participant.mjs';
import { compare, isValid } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const [name, version] = args._;
const dry = Boolean(args['dry-run']);
const problems = [];
if (!name || !version || !isValid(version)) failIfAny('Usage: npm run release:participant:prepare -- <name> <version>', [`"${name ?? ''} ${version ?? ''}" is not a name and a valid version`]);
const pkg = loadParticipant(ROOT, name);
const current = pkg.json.version;
if (compare(version, current) < 0 || (compare(version, current) === 0 && current !== '0.0.1')) problems.push(`${version} must be greater than the current version ${current}`);
if (git(['status', '--porcelain']).stdout.trim()) problems.push('the working tree has uncommitted changes; commit or stash them first');
git(['fetch', 'origin', '--tags', '--quiet']);
const tag = tagFor(name, version);
if (git(['tag', '--list', tag]).stdout.trim() || git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).stdout.trim()) problems.push(`tag ${tag} already exists`);
const notes = readNotes(ROOT, name, version);
const priorTags = git(['tag', '--list', `${name}@*`]).stdout.split('\n').filter(Boolean);
if (notes === null) problems.push(`write and commit the release notes first: ${notesPath(ROOT, name, version).replace(ROOT, '.')}`);
else problems.push(...checkNotes(notes, name, version, { first: priorTags.length === 0 }));
failIfAny(`Cannot prepare ${tag}:`, problems);

// Range policy: "*" between @brud packages becomes ^<that package's workspace version>; the kernel moves to peerDependencies.
const versions = new Map(listPackages(ROOT).map((p) => [p.json.name, p.json.version]));
const j = structuredClone(pkg.json);
const changes = [];
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [dep, range] of Object.entries(j[field] ?? {})) {
    if (dep.startsWith(SCOPE) && /^(\*|latest)?$/.test(String(range)) && versions.has(dep)) {
      j[field][dep] = `^${versions.get(dep)}`;
      changes.push(`${field}.${dep}: ${range} -> ^${versions.get(dep)}`);
    }
  }
}
if (j.dependencies?.['@brud/kernel'] !== undefined) {
  j.peerDependencies = { ...(j.peerDependencies ?? {}), '@brud/kernel': j.dependencies['@brud/kernel'] };
  delete j.dependencies['@brud/kernel'];
  changes.push('@brud/kernel: dependencies -> peerDependencies');
}
j.version = version;
if (dry) {
  console.log(`Dry run: ${current} -> ${version}. Would change:\n${changes.map((c) => `  ${c}`).join('\n') || '  (no ranges)'}`);
  process.exit(0);
}
writeJson(pkg.file, j);
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: ROOT });
const after = checkParticipant(ROOT, name, { version });
if (after.length) {
  git(['checkout', '--', '.']);
  failIfAny('The bump left the tree inconsistent, so it was reverted:', after);
}
git(['add', '-A']);
git(['commit', '-m', `release(${name}): ${tag}`, '-m', `Bump ${pkg.json.name} from ${current} to ${version}.`]);
console.log(`\nCommitted "release(${name}): ${tag}".`);
console.log(`Next: push it, wait for CI, then once it is on main: npm run release:participant:tag -- ${name} ${version} --push`);
