#!/usr/bin/env node
// Pre-flight checks for a participant release. Runs locally and as the first CI job.
//   node scripts/release-participant/verify.mjs --tag <name>@<version> [--ci] [--github-output file]
//   node scripts/release-participant/verify.mjs --name <name> [--version X]
import { appendFileSync } from 'node:fs';
import { ROOT, parseArgs } from './lib/args.mjs';
import { git, failIfAny, run } from './lib/exec.mjs';
import { SCOPE, checkNotes, checkParticipant, listPackages, loadParticipant, notesPath, parseTag, readNotes, tagFor } from './lib/participant.mjs';
import { compare, distTag, isPrerelease } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const tag = args.tag;
const parsed = tag ? parseTag(tag) : null;
if (tag && !parsed) failIfAny('Not a participant release tag:', [`"${tag}" must look like <name>@1.2.3`]);
const name = parsed?.name ?? args.name;
if (!name) failIfAny('Usage: verify.mjs --tag <name>@<version> | --name <name> [--version X]', ['a participant name is required']);
const version = parsed?.version ?? args.version ?? loadParticipant(ROOT, name).json.version;
const problems = [...checkParticipant(ROOT, name, { version, tag })];

const priorTags = git(['tag', '--list', `${name}@*`, '--sort=-v:refname']).stdout
  .split('\n').map((t) => t.trim()).filter((t) => t && t !== tagFor(name, version));
const first = priorTags.length === 0;
const notes = readNotes(ROOT, name, version);
if (notes === null) problems.push(`release notes are missing: ${notesPath(ROOT, name, version).replace(ROOT, '.')}`);
else problems.push(...checkNotes(notes, name, version, { first }));

// A published participant needs its @brud dependencies on npm at a version the declared range allows.
const known = new Set(listPackages(ROOT).map((p) => p.json.name));
const pkg = loadParticipant(ROOT, name).json;
const registry = (spec, field) => run('npm', ['view', spec, field, '--json', '--prefer-online'], { check: false });
for (const field of ['dependencies', 'peerDependencies']) {
  for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
    if (!dep.startsWith(SCOPE) || !known.has(dep) || /^(\*|latest)?$/.test(range)) continue;
    const r = registry(`${dep}@${range}`, 'version');
    if (r.status !== 0 || !r.stdout.trim()) problems.push(`${field}.${dep}@${range} is not on npm yet; release that package first`);
  }
}

if (args.ci && tag) {
  const type = git(['cat-file', '-t', `refs/tags/${tag}`], { check: false }).stdout.trim();
  if (type !== 'tag') problems.push(`${tag} must be an annotated tag (found: ${type || 'none'})`);
  const commit = git(['rev-list', '-n', '1', tag]).stdout.trim();
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  if (commit !== head) problems.push(`${tag} points at ${commit.slice(0, 8)}, but the checkout is ${head.slice(0, 8)}`);
  if (git(['merge-base', '--is-ancestor', commit, 'origin/main'], { check: false }).status !== 0) problems.push(`${tag} is not on main`);
}

// Already on npm with this version? (adopt: nothing is published; the tarball is fetched from the registry)
const r = run('npm', ['view', `${SCOPE}${name}@${version}`, 'version', '--prefer-online'], { check: false });
const adopt = r.status === 0 && r.stdout.trim() === version;
if (!adopt && priorTags[0]) {
  const prev = parseTag(priorTags[0]);
  if (prev && compare(version, prev.version) <= 0) problems.push(`${version} must be greater than the previous release ${prev.version}`);
}

failIfAny(`Release of ${SCOPE}${name} ${version} is not ready:`, problems);

const summary = {
  name, version,
  prerelease: String(isPrerelease(version)),
  dist_tag: distTag(version),
  previous_tag: priorTags[0] ?? '',
  first: String(first),
  adopt: String(adopt),
};
console.log(`Release of ${SCOPE}${name} ${version} is ready.`);
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
if (args['github-output']) appendFileSync(args['github-output'], `${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
