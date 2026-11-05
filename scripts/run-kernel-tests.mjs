#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packagesRoot = resolve(scriptDirectory, '..', 'packages');
const kernelRoot = join(packagesRoot, 'kernel');
const pluginsRoot = join(packagesRoot, 'plugins');

const TARGETS = [
  { directory: 'src/__tests__', recursive: false },
  { directory: 'src/__tests__/goals', recursive: false },
  { directory: 'src/__tests__/plugins', recursive: false },
  { directory: 'drivers', recursive: true },
  { directory: 'services', recursive: true },
];

const EXCLUDED_DIRECTORY_NAMES = new Set(['node_modules', 'dist']);

async function collectTestFiles(directory, recursive) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (recursive && !EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        files.push(...await collectTestFiles(absolutePath, true));
      }

      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function collectPluginTestFiles(root) {
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const files = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    files.push(
      ...await collectTestFiles(join(root, entry.name, 'src'), true),
    );
  }

  return files;
}

const discovered = [];

for (const target of TARGETS) {
  discovered.push(
    ...await collectTestFiles(join(kernelRoot, target.directory), target.recursive),
  );
}

discovered.push(...await collectPluginTestFiles(pluginsRoot));

const testFiles = [...new Set(discovered)].sort();

if (testFiles.length === 0) {
  console.error('No kernel test files were found.');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-force-exit', ...testFiles],
  { cwd: kernelRoot, stdio: 'inherit' },
);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);

    return;
  }

  process.exit(code ?? 1);
});