import { posix } from 'node:path';
import type { SearchFileSystem } from './fsPort.js';
import { isGlobPattern, matchGlob } from './globMatcher.js';
import type { FileSearchQuery, FileSearchResponse, FileSearchResult } from './types.js';
import { FileSearchQueryError } from './types.js';

const SKIP_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', '.git', '.svn', '.hg', '.next',
  '.nuxt', 'out', '.cache', '__pycache__', '.yarn', '.pnp',
]);

function normalizeDirectory(input: string | undefined): string {
  if (input === undefined) {
    return '';
  }

  let value = input.replace(/\\/g, '/');
  while (value.startsWith('./')) {
    value = value.slice(2);
  }
  value = value.replace(/\/+$/u, '');
  return value === '.' ? '' : value;
}

function joinRelative(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRECTORIES.has(name);
}

function parseFileInfo(relativePath: string, size: number): FileSearchResult {
  const ext = posix.extname(relativePath);
  const basename = posix.basename(relativePath);
  const name = ext ? basename.slice(0, -ext.length) : basename;
  const dir = posix.dirname(relativePath);
  return {
    path: relativePath,
    name,
    extension: ext,
    directory: dir === '.' ? '' : dir,
    size,
  };
}

function matchesPatterns(relativePath: string, patterns: string[]): boolean {
  const basename = posix.basename(relativePath);
  const nameWithoutExt = posix.basename(relativePath, posix.extname(relativePath));

  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) {
      if (matchGlob(pattern, relativePath)) {
        return true;
      }
      continue;
    }

    if (
      basename.toLowerCase().includes(pattern.toLowerCase())
      || nameWithoutExt.toLowerCase().includes(pattern.toLowerCase())
    ) {
      return true;
    }

    if (pattern.includes('/') || pattern.includes('\\')) {
      const normalizedRel = relativePath.replace(/\\/g, '/');
      const normalizedPattern = pattern.replace(/\\/g, '/');
      if (
        normalizedRel === normalizedPattern
        || normalizedRel.endsWith(normalizedPattern)
        || normalizedRel.toLowerCase().includes(normalizedPattern.toLowerCase())
      ) {
        return true;
      }
    }
  }

  return false;
}

function matchesExtension(relativePath: string, extensions: string[]): boolean {
  if (!extensions || extensions.length === 0) {
    return true;
  }

  const ext = posix.extname(relativePath);
  return extensions.some(candidate => candidate === ext);
}

function matchesExcludePatterns(relativePath: string, excludePatterns: string[]): boolean {
  if (!excludePatterns || excludePatterns.length === 0) {
    return false;
  }

  const basename = posix.basename(relativePath);
  for (const pattern of excludePatterns) {
    if (isGlobPattern(pattern)) {
      if (matchGlob(pattern, relativePath)) {
        return true;
      }
    } else if (basename.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

async function walkDirectory(
  directoryPath: string,
  fs: SearchFileSystem,
  query: FileSearchQuery,
  results: FileSearchResult[],
  state: { totalMatches: number },
): Promise<void> {
  let entries;
  try {
    entries = await fs.readDirectory(directoryPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = joinRelative(directoryPath, entry.name);

    if (entry.isDirectory) {
      if (shouldSkipDirectory(entry.name)) continue;
      if (query.recursive) {
        await walkDirectory(fullPath, fs, query, results, state);
      }
      continue;
    }

    if (!matchesExtension(fullPath, query.extensions ?? [])) continue;
    if (!matchesPatterns(fullPath, query.patterns)) continue;
    if (matchesExcludePatterns(fullPath, query.excludePatterns ?? [])) continue;

    state.totalMatches++;

    if (results.length < (query.maxResults ?? Infinity)) {
      let size = 0;
      try {
        const stats = await fs.stat(fullPath);
        size = stats?.size ?? 0;
      } catch {
        size = 0;
      }
      results.push(parseFileInfo(fullPath, size));
    }
  }
}

/**
 * Searches a workspace-relative directory for files matching the query.
 *
 * This is the SDK entry point: it depends only on the read-only
 * {@link SearchFileSystem} port, so other plugins can reuse it without
 * activating the Search plugin.
 *
 * @param fs - Read-only workspace filesystem port.
 * @param query - Patterns, filters, scope, and result bounds.
 * @throws {FileSearchQueryError} When no patterns are supplied.
 */
export async function searchFiles(
  fs: SearchFileSystem,
  query: FileSearchQuery,
): Promise<FileSearchResponse> {
  if (!query.patterns || query.patterns.length === 0) {
    throw new FileSearchQueryError(
      'MISSING_FIELD',
      'The field "patterns" is required in search operation.',
    );
  }

  const baseDir = normalizeDirectory(query.directory);
  const results: FileSearchResult[] = [];
  const state = { totalMatches: 0 };

  await walkDirectory(baseDir, fs, query, results, state);

  return {
    results,
    totalMatches: state.totalMatches,
    truncated: state.totalMatches > (query.maxResults ?? Infinity),
  };
}