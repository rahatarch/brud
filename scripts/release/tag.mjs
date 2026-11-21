#!/usr/bin/env node
// Step 2 of a release: tag the release commit on main. The tag push starts the release workflow.
//   npm run release:tag -- <version> [--push] [--sign]
import { ROOT, parseArgs } from './lib/args.mjs';
import { git, failIfAny } from './lib/exec.mjs';
import { checkVersions } from './lib/packages.mjs';
import { checkNotes, readNotes } from './lib/notes.mjs';
import { isValid } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const version = args._[0];
const problems = [];
if (!version || !isValid(version)) failIfAny('Usage: npm run release:tag -- <version> [--push]', [`"${version ?? ''}" is not a valid version`]);
const tag = `v${version}`;

if (git(['status', '--porcelain']).stdout.trim()) problems.push('the working tree has uncommitted changes');
git(['fetch', 'origin', '--tags', '--quiet']);
const head = git(['rev-parse', 'HEAD']).stdout.trim();
const main = git(['rev-parse', 'origin/main']).stdout.trim();
if (head !== main) problems.push('HEAD is not the same commit as origin/main; check out and pull main first');
if (git(['tag', '--list', tag]).stdout.trim() || git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).stdout.trim()) {
  problems.push(`${tag} already exists; never move or reuse a tag`);
}
problems.push(...checkVersions(ROOT, { version }));
const notes = readNotes(ROOT, version);
const priorTags = git(['tag', '--list', 'v*']).stdout.split('\n').filter(Boolean);
if (notes === null) problems.push(`docs/release-notes/${tag}.md is missing`);
else problems.push(...checkNotes(notes, version, { first: priorTags.length === 0 }));
failIfAny(`Cannot tag ${version}:`, problems);

git(['tag', args.sign ? '-s' : '-a', tag, '-m', `BrudOS ${version}`]);
console.log(`Created annotated tag ${tag} on ${head.slice(0, 8)}.`);
if (args.push) {
  git(['push', 'origin', tag]);
  console.log(`Pushed ${tag}. The release workflow is starting; approve it in GitHub when the checks are green.`);
} else {
  console.log(`Push it when ready: git push origin ${tag}`);
}
