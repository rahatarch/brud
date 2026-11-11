import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to `packages/kernel/src/__tests__/goals`. */
export const GOALS_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path to `packages/kernel`. */
export const KERNEL_ROOT = resolve(GOALS_DIR, '../../..');

/** Absolute path to the repository root. */
export const REPO_ROOT = resolve(KERNEL_ROOT, '../..');

/** Absolute path to the cross-platform CI workflow. */
export const CI_WORKFLOW = join(REPO_ROOT, '.github/workflows/test-matrix.yml');

/** The two daemon test files B0 deferred to Phase 10. */
export const DEFERRED_DAEMON_TESTS: readonly string[] = [
  'packages/daemon/src/__tests__/dispatch.test.ts',
  'packages/daemon/src/__tests__/lifecycle.test.ts',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.kilo',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'temporary',
]);

export interface WalkOptions {
  /** Additional absolute paths (files or directories) to skip. */
  readonly skipPaths?: readonly string[];
}

/**
 * Recursively lists source files under a root.
 *
 * Skips generated and vendored directories, plus any caller-supplied path.
 * Paths are absolute and stable-sorted so callers can compare results.
 */
export async function walkSourceFiles(
  root: string,
  options?: WalkOptions,
): Promise<string[]> {
  const skip = new Set((options?.skipPaths ?? []).map((entry) => resolve(entry)));
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);

      if (skip.has(resolve(absolutePath))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = entry.name.slice(entry.name.lastIndexOf('.'));

      if (SOURCE_EXTENSIONS.has(extension)) {
        files.push(absolutePath);
      }
    }
  }

  await visit(resolve(root));

  return files.sort();
}

/**
 * Removes line and block comments while preserving code and string literals.
 *
 * The goal tests use this to distinguish a live identifier reference from a
 * historical comment that names the deleted double.
 */
export function stripComments(source: string): string {
  let output = '';
  let index = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (current === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }

      if (current === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }

      if (current === "'") {
        state = 'single';
      } else if (current === '"') {
        state = 'double';
      } else if (current === '`') {
        state = 'template';
      }

      output += current;
      index += 1;
      continue;
    }

    if (state === 'line') {
      if (current === '\n') {
        state = 'code';
        output += current;
      }

      index += 1;
      continue;
    }

    if (state === 'block') {
      if (current === '*' && next === '/') {
        state = 'code';
        index += 2;
      } else {
        if (current === '\n') {
          output += current;
        }

        index += 1;
      }

      continue;
    }

    if (current === '\\') {
      output += current;

      if (index + 1 < source.length) {
        output += source[index + 1];
      }

      index += 2;
      continue;
    }

    if (
      (state === 'single' && current === "'")
      || (state === 'double' && current === '"')
      || (state === 'template' && current === '`')
    ) {
      state = 'code';
    }

    output += current;
    index += 1;
  }

  return output;
}

/** Converts an absolute path into the repository-relative slash form. */
export function repoRelative(absolutePath: string): string {
  return absolutePath.startsWith(`${REPO_ROOT}${sep}`)
    ? absolutePath.slice(REPO_ROOT.length + 1).split(sep).join('/')
    : absolutePath;
}

/** Reads a repository file as UTF-8. */
export async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(join(REPO_ROOT, relativePath), 'utf8');
}

/** Reports whether a string contains a live (non-comment) identifier. */
export function liveOccurrences(source: string, identifier: string): number {
  return stripComments(source).split(identifier).length - 1;
}