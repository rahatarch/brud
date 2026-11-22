#!/usr/bin/env node
// Pre-flight checks for a CLI release. Runs locally and as the first CI job.
//   node scripts/release-cli/verify.mjs [--version X] [--tag cli-vX] [--ci] [--github-output file]
import { appendFileSync } from 'node:fs';
import { ROOT, parseArgs } from './lib/args.mjs';
import { git, failIfAny, run } from './lib/exec.mjs';
import { CLI_NAME, TAG_PREFIX, checkCli, checkNotes, loadCli, notesPath, readNotes } from './lib/cli.mjs';
import { distTag, isPrerelease } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const tag = args.tag;
const version = args.version ?? (tag ? tag.replace(new RegExp(`^${TAG_PREFIX}`), '') : undefined);
const problems = [...checkCli(ROOT, { version, tag })];
const expected = version ?? loadCli(ROOT).json.version;

const priorTags = git(['tag', '--list', `${TAG_PREFIX}*`, '--sort=-v:refname']).stdout
  .split('\n').map((t) => t.trim()).filter((t) => t && t !== `${TAG_PREFIX}${expected}`);
const first = priorTags.length === 0;
const notes = readNotes(ROOT, expected);
if (notes === null) problems.push(`release notes are missing: ${notesPath(ROOT, expected).replace(ROOT, '.')}`);
else problems.push(...checkNotes(notes, expected, { first }));

if (args.ci && tag) {
  const type = git(['cat-file', '-t', `refs/tags/${tag}`], { check: false }).stdout.trim();
  if (type !== 'tag') problems.push(`${tag} must be an annotated tag (found: ${type || 'none'})`);
  const commit = git(['rev-list', '-n', '1', tag]).stdout.trim();
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  if (commit !== head) problems.push(`${tag} points at ${commit.slice(0, 8)}, but the checkout is ${head.slice(0, 8)}`);
  const onMain = git(['merge-base', '--is-ancestor', commit, 'origin/main'], { check: false }).status === 0;
  if (!onMain) problems.push(`${tag} is not on main`);
}

// Is this version already on npm? (adopt = yes, so nothing is published; the tarball is fetched from the registry)
const r = run('npm', ['view', `${CLI_NAME}@${expected}`, 'version', '--prefer-online'], { check: false });
const adopt = r.status === 0 && r.stdout.trim() === expected;

failIfAny(`CLI release ${expected} is not ready:`, problems);

const summary = {
  version: expected,
  prerelease: String(isPrerelease(expected)),
  dist_tag: distTag(expected),
  previous_tag: priorTags[0] ?? '',
  first: String(first),
  adopt: String(adopt),
};
console.log(`CLI release ${expected} is ready.`);
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
if (args['github-output']) appendFileSync(args['github-output'], `${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
