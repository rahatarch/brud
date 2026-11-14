// Verifies that dist/ contains only what the current source produces.
//
// Every emitted `.js` and `.d.ts` file must correspond to a current,
// non-test TypeScript source file inside the compiled roots. A stale file
// whose source no longer exists fails packaging.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function walk(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }

  return found;
}

if (!existsSync(dist)) {
  console.error('dist/ does not exist; build before packaging');
  process.exit(1);
}

const stale = [];

for (const file of walk(dist)) {
  const emitted = relative(dist, file);
  const stem = emitted.endsWith('.d.ts')
    ? emitted.slice(0, -'.d.ts'.length)
    : emitted.endsWith('.js')
      ? emitted.slice(0, -'.js'.length)
      : undefined;

  if (stem === undefined || !existsSync(join(root, `${stem}.ts`))) {
    stale.push(emitted);
  }
}

if (stale.length > 0) {
  console.error(`dist/ contains files the current source does not produce:\n${stale.join('\n')}`);
  process.exit(1);
}
