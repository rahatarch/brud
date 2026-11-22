#!/usr/bin/env node
// Publishes the tested CLI tarball to npm. Safe to re-run.
//   node scripts/release-cli/publish.mjs --dir dist-release-cli [--dry-run]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { run } from './lib/exec.mjs';
import { verifySums } from './lib/integrity.mjs';
import { decide } from './lib/publish-plan.mjs';
import { distTag } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release-cli');
const dry = Boolean(args['dry-run']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sumProblems = verifySums(dir);
if (sumProblems.length) { console.error(`Refusing to publish: ${sumProblems.join('; ')}`); process.exit(1); }
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const [pkg] = packages;
const tag = distTag(version);

function registryIntegrity() {
  const r = run('npm', ['view', `${pkg.name}@${version}`, 'dist.integrity', '--prefer-online'], { check: false });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  if (/E404|404/.test(`${r.stdout}${r.stderr}`)) return null;
  throw new Error(`could not read ${pkg.name}@${version} from the registry:\n${r.stderr}`);
}

console.log(`Publishing ${pkg.name}@${version} with dist-tag "${tag}"${dry ? ' (dry run)' : ''}`);
const action = decide(pkg.integrity, dry ? null : registryIntegrity());
if (action === 'conflict') {
  console.error(`\n${pkg.name}@${version} already exists on npm with different contents.`);
  console.error('Never overwrite a release. Choose a new version and run the release again.');
  process.exit(1);
}
if (action === 'skip') {
  console.log(`  [skip] ${pkg.name}@${version} is already published, identical bytes`);
  process.exit(0);
}
const publishArgs = ['publish', join(dir, pkg.file), '--access', 'public', '--tag', tag];
if (process.env.GITHUB_ACTIONS) publishArgs.push('--provenance');
if (dry) publishArgs.push('--dry-run');
run('npm', publishArgs, { inherit: true });
if (!dry) {
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const seen = registryIntegrity();
    if (seen === pkg.integrity) break;
    if (seen !== null) throw new Error(`${pkg.name}@${version} is on the registry with different bytes (${seen})`);
    if (Date.now() > deadline) throw new Error(`${pkg.name}@${version} did not appear on the registry within 15 minutes`);
    await sleep(15_000);
  }
  const tags = JSON.parse(run('npm', ['view', pkg.name, 'dist-tags', '--json', '--prefer-online']).stdout);
  if (tags[tag] !== version) { console.error(`${pkg.name}: dist-tag "${tag}" is ${tags[tag]}, expected ${version}`); process.exit(1); }
}
console.log(`  [ok] ${pkg.name}@${version}`);
