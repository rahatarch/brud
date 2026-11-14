// Runs the kernel package's own test files from inside the package.
//
// Collects every `*.test.ts` under the kernel folder, outside build output and
// dependencies, and runs them with Node's test runner through the declared
// `tsx` loader. Extra arguments are forwarded to `node --test`.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skipped = new Set(['node_modules', 'dist', 'scripts']);

function collect(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) {
      continue;
    }

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...collect(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      found.push(relative(root, full));
    }
  }

  return found;
}

const files = collect(root).sort();
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files],
  { cwd: root, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
