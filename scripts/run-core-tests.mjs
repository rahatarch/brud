import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

const testFiles = [];

function collectTestFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      collectTestFiles(fullPath);
    } else if (entry.endsWith('.test.ts') && stats.isFile()) {
      testFiles.push(fullPath);
    }
  }
}

collectTestFiles(join(root, 'packages', 'core', 'src'));

if (testFiles.length === 0) {
  console.error('No test files found under packages/core/src/');
  process.exit(1);
}

const relativePaths = testFiles.map(f => relative(root, f));

console.log(`Found ${relativePaths.length} test file(s):`);
for (const p of relativePaths) {
  console.log(`  ${p}`);
}

const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});