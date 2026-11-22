// Checks commit messages against the standard in CONTRIBUTING.md.
//   node scripts/commit-standard/check.mjs --file <path>        one message file (the commit-msg hook)
//   node scripts/commit-standard/check.mjs --range <base>..<head>   every non-merge commit in a range (CI)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkMessage } from './lib.mjs';

const [mode, value] = process.argv.slice(2);
const failures = [];

if (mode === '--file' && value !== undefined) {
  const problems = checkMessage(readFileSync(value, 'utf8'));

  if (problems.length > 0) {
    failures.push({ id: 'this commit', problems });
  }
} else if (mode === '--range' && value !== undefined) {
  const log = spawnSync('git', ['log', '--no-merges', '--format=%H%x00%B%x01', value], { encoding: 'utf8' });

  if (log.status !== 0) {
    console.error(`git log failed for range "${value}": ${log.stderr.trim()}`);
    process.exit(2);
  }

  for (const entry of log.stdout.split('\x01')) {
    const [hash, ...rest] = entry.replace(/^\n+/, '').split('\x00');

    if (hash === undefined || hash === '') {
      continue;
    }

    const problems = checkMessage(rest.join('\x00'));

    if (problems.length > 0) {
      failures.push({ id: hash.slice(0, 10), problems });
    }
  }
} else {
  console.error('usage: check.mjs --file <path> | --range <base>..<head>');
  process.exit(2);
}

if (failures.length > 0) {
  console.error('Commit message does not follow the standard (see "Commit Message Guidelines" in CONTRIBUTING.md):');

  for (const { id, problems } of failures) {
    for (const problem of problems) {
      console.error(`  ${id}: ${problem}`);
    }
  }

  process.exit(1);
}
