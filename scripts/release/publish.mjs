#!/usr/bin/env node
// Publishes the tested tarballs to npm, in dependency order. Safe to re-run.
//   node scripts/release/publish.mjs --dir dist-release [--dry-run]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { run } from './lib/exec.mjs';
import { verifySums } from './lib/integrity.mjs';
import { decide } from './lib/publish-plan.mjs';
import { distTag } from './lib/semver.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? 'dist-release');
const dry = Boolean(args['dry-run']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sumProblems = verifySums(dir);
if (sumProblems.length) {
  console.error(`Refusing to publish: ${sumProblems.join('; ')}`);
  process.exit(1);
}
const { version, packages } = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
const tag = distTag(version);

function registryIntegrity(name) {
  const r = run('npm', ['view', `${name}@${version}`, 'dist.integrity', '--prefer-online'], { check: false });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  if (/E404|404/.test(`${r.stdout}${r.stderr}`)) return null;
  throw new Error(`could not read ${name}@${version} from the registry:\n${r.stderr}`);
}

async function waitVisible(name, integrity) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const seen = registryIntegrity(name);
    if (seen === integrity) return;
    if (seen !== null) throw new Error(`${name}@${version} is on the registry with different bytes (${seen})`);
    await sleep(15_000);
  }
  throw new Error(`${name}@${version} did not appear on the registry within 15 minutes`);
}

console.log(`Publishing ${packages.length} packages at ${version} with dist-tag "${tag}"${dry ? ' (dry run)' : ''}`);
let published = 0;
for (const pkg of packages) {
  const action = decide(pkg.integrity, dry ? null : registryIntegrity(pkg.name));
  if (action === 'conflict') {
    console.error(`\n${pkg.name}@${version} already exists on npm with different contents.`);
    console.error('Never overwrite a release. Choose a new version and run the release again.');
    process.exit(1);
  }
  if (action === 'skip') {
    console.log(`  [skip] ${pkg.name}@${version} is already published, identical bytes`);
    continue;
  }
  const publishArgs = ['publish', join(dir, pkg.file), '--access', 'public', '--tag', tag];
  if (process.env.GITHUB_ACTIONS) publishArgs.push('--provenance');
  if (dry) publishArgs.push('--dry-run');
  console.log(`  [..] publishing ${pkg.name}@${version}`);
  run('npm', publishArgs, { inherit: true });
  if (!dry) {
    await waitVisible(pkg.name, pkg.integrity);
    published++;
  }
  console.log(`  [ok] ${pkg.name}@${version}`);
}

if (!dry) {
  for (const pkg of packages) {
    const tags = JSON.parse(run('npm', ['view', pkg.name, 'dist-tags', '--json', '--prefer-online']).stdout);
    if (tags[tag] !== version) {
      console.error(`${pkg.name}: dist-tag "${tag}" is ${tags[tag]}, expected ${version}`);
      process.exit(1);
    }
  }
}
console.log(`Done: ${published} published, ${packages.length - published} already present.`);
