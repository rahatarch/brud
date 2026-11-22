#!/usr/bin/env node
// Builds the GitHub Release body: the human notes plus generated Packages and Verification.
//   node scripts/release-participant/body.mjs --dir dist-release-participant --tag <name>@X --commit sha [--run-url url] [--repo owner/name] [--previous <name>@Y] --out release-body.md
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { failIfAny } from './lib/exec.mjs';
import { SCOPE, buildBody, checkNotes, loadParticipant, readNotes, tagFor } from './lib/participant.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release-participant');
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const pkg = packages[0];
const name = pkg.name.slice(SCOPE.length);
const notes = readNotes(ROOT, name, version);
if (notes === null) failIfAny('Release notes are missing:', [`docs/release-notes/${tagFor(name, version)}.md`]);
failIfAny('The release notes are not ready:', checkNotes(notes, name, version, { first: !args.previous }));
const body = buildBody({
  notes, pkg,
  nodeRange: loadParticipant(ROOT, name).json.engines?.node,
  commit: args.commit ?? process.env.GITHUB_SHA ?? 'unknown',
  tag: args.tag ?? tagFor(name, version),
  runUrl: args['run-url'],
  repo: args.repo ?? process.env.GITHUB_REPOSITORY ?? 'rahatarch/brud',
  previousTag: args.previous || undefined,
});
writeFileSync(resolve(args.out ?? 'release-body.md'), body);
console.log(`Wrote the release body (${body.length} characters).`);
