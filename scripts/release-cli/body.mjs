#!/usr/bin/env node
// Builds the GitHub Release body: the human notes plus generated Packages and Verification.
//   node scripts/release-cli/body.mjs --dir dist-release-cli --tag cli-vX --commit sha [--run-url url] [--repo owner/name] [--previous cli-vY] --out release-body.md
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, parseArgs } from './lib/args.mjs';
import { failIfAny } from './lib/exec.mjs';
import { buildBody, checkNotes, loadCli, readNotes, tagFor } from './lib/cli.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release-cli');
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const notes = readNotes(ROOT, version);
if (notes === null) failIfAny('Release notes are missing:', [`docs/release-notes/${tagFor(version)}.md`]);
failIfAny('The release notes are not ready:', checkNotes(notes, version, { first: !args.previous }));
const body = buildBody({
  notes,
  pkg: packages[0],
  nodeRange: loadCli(ROOT).json.engines?.node,
  commit: args.commit ?? process.env.GITHUB_SHA ?? 'unknown',
  tag: args.tag ?? tagFor(version),
  runUrl: args['run-url'],
  repo: args.repo ?? process.env.GITHUB_REPOSITORY ?? 'rahatarch/brud',
  previousTag: args.previous || undefined,
});
writeFileSync(resolve(args.out ?? 'release-body.md'), body);
console.log(`Wrote the release body (${body.length} characters).`);
