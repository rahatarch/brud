#!/usr/bin/env node
// Prints the one-time setup for first publishes. Changes nothing, publishes nothing.
//   node scripts/release-participant/bootstrap.mjs <name...> | --all
// A package must exist on npm before it can have a trusted publisher, so each participant's FIRST
// publish is by hand with 2FA; every later release goes through the workflow.
import { ROOT, parseArgs } from './lib/args.mjs';
import { run } from './lib/exec.mjs';
import { RESERVED, loadParticipant, participants } from './lib/participant.mjs';

const args = parseArgs(process.argv.slice(2), ['all']);
const names = args.all ? participants(ROOT).map((p) => p.json.name.slice('@brud/'.length)) : args._;
if (names.length === 0) { console.error('Usage: bootstrap.mjs <name...> | --all'); process.exit(1); }
const repo = process.env.GITHUB_REPOSITORY ?? 'rahatarch/brud';
for (const name of names) {
  if (RESERVED.includes(name)) { console.log(`# ${name}: reserved for core packages, skipped\n`); continue; }
  const pkg = loadParticipant(ROOT, name).json;
  const r = run('npm', ['view', pkg.name, 'version', '--prefer-online'], { check: false });
  const onNpm = r.status === 0 && r.stdout.trim();
  console.log(`# ${pkg.name} ${pkg.version}: ${onNpm ? `already on npm (${onNpm})` : 'NOT on npm yet'}`);
  if (!onNpm) {
    console.log(`npm run build:services && node scripts/release-participant/pack.mjs --name ${name} --out /tmp/p-${name}`);
    console.log(`npm publish /tmp/p-${name}/brud-${pkg.name.split('/')[1]}-${pkg.version}.tgz --access public   # by hand, with 2FA`);
  }
  console.log(`npm trust github ${pkg.name} --file release-participant.yml --repo ${repo} --env release-participant --allow-publish --allow-stage-publish\n`);
}
