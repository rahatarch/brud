#!/usr/bin/env node
// Builds the GitHub Release body: the human notes plus generated Packages and Verification.
//   node scripts/release/body.mjs --dir dist-release --tag vX --commit sha [--run-url url] [--repo owner/name] [--previous vY] --out release-body.md
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { loadCore } from './lib/packages.mjs';
import { buildBody, checkNotes, readNotes } from './lib/notes.mjs';
import { failIfAny } from './lib/exec.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release');
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const tag = args.tag ?? `v${version}`;
const notes = readNotes(ROOT, version);
if (notes === null) failIfAny('Release notes are missing:', [`docs/release-notes/v${version}.md`]);
failIfAny('The release notes are not ready:', checkNotes(notes, version, { first: !args.previous }));
const kernel = loadCore(ROOT).find((p) => p.json.name === '@brud/kernel');
const body = buildBody({
  notes,
  packages,
  nodeRange: kernel?.json.engines?.node,
  commit: args.commit ?? process.env.GITHUB_SHA ?? 'unknown',
  tag,
  runUrl: args['run-url'],
  repo: args.repo ?? process.env.GITHUB_REPOSITORY ?? 'rahatarch/brud',
  previousTag: args.previous || undefined,
});
writeFileSync(resolve(args.out ?? 'release-body.md'), body);
console.log(`Wrote the release body (${body.length} characters).`);
