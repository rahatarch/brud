import * as pathModule from 'path';
import { FileSystem } from '../types/filesystem.js';
import { isGlobPattern, matchGlob } from './globMatcher.js';
import { FileSearchQuery, FileSearchResponse, FileSearchResult } from './types.js';

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.hg', '.next', '.nuxt', 'out', '.cache', '__pycache__', '.yarn', '.pnp']);

function isHiddenDirectory(name: string): boolean {
  return name.startsWith('.');
}

function shouldSkipDirectory(name: string): boolean {
  return isHiddenDirectory(name) || SKIP_DIRECTORIES.has(name);
}

function parseFileInfo(filePath: string, baseDir: string, size: number): FileSearchResult {
  const relativePath = pathModule.relative(baseDir, filePath);
  const ext = pathModule.extname(filePath);
  const basename = pathModule.basename(filePath);
  const name = ext ? basename.slice(0, -ext.length) : basename;
  const dir = pathModule.dirname(relativePath);
  return {
    path: relativePath,
    name,
    extension: ext,
    directory: dir === '.' ? '' : dir,
    size,
  };
}

function matchesPatterns(filePath: string, patterns: string[], baseDir: string): boolean {
  const relativePath = pathModule.relative(baseDir, filePath);
  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) {
      if (matchGlob(pattern, relativePath)) {
        return true;
      }
    } else {
      const basename = pathModule.basename(filePath);
      const nameWithoutExt = pathModule.basename(filePath, pathModule.extname(filePath));
      if (basename.toLowerCase().includes(pattern.toLowerCase()) || nameWithoutExt.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

function matchesExtension(filePath: string, extensions: string[]): boolean {
  if (!extensions || extensions.length === 0) return true;
  const ext = pathModule.extname(filePath);
  return extensions.some(e => e === ext);
}

function matchesExcludePatterns(filePath: string, excludePatterns: string[], baseDir: string): boolean {
  if (!excludePatterns || excludePatterns.length === 0) return false;
  const relativePath = pathModule.relative(baseDir, filePath);
  for (const pattern of excludePatterns) {
    if (isGlobPattern(pattern)) {
      if (matchGlob(pattern, relativePath)) {
        return true;
      }
    } else {
      const basename = pathModule.basename(filePath);
      if (basename.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

async function walkDirectory(
  dirPath: string,
  baseDir: string,
  fs: FileSystem,
  query: FileSearchQuery,
  results: FileSearchResult[],
  state: { totalMatches: number },
): Promise<void> {
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = await fs.listDirectoryContents(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = pathModule.join(dirPath, entry.name);

    if (entry.isDirectory) {
      if (shouldSkipDirectory(entry.name)) continue;

      if (query.recursive) {
        await walkDirectory(fullPath, baseDir, fs, query, results, state);
      }
    } else {
      if (!matchesExtension(fullPath, query.extensions || [])) continue;
      if (!matchesPatterns(fullPath, query.patterns, baseDir)) continue;
      if (matchesExcludePatterns(fullPath, query.excludePatterns || [], baseDir)) continue;

      state.totalMatches++;

      if (results.length < (query.maxResults ?? 500)) {
        let statSize = 0;
        try {
          const content = await fs.readFile(fullPath);
          statSize = Buffer.byteLength(content, 'utf8');
        } catch {
          statSize = 0;
        }
        results.push(parseFileInfo(fullPath, baseDir, statSize));
      }
    }
  }
}

export async function searchFiles(fs: FileSystem, query: FileSearchQuery): Promise<FileSearchResponse> {
  if (!query.patterns || query.patterns.length === 0) {
    throw new Error('At least one search pattern is required');
  }

  const baseDir = query.directory || process.cwd();
  const results: FileSearchResult[] = [];
  const state = { totalMatches: 0 };

  await walkDirectory(baseDir, baseDir, fs, query, results, state);

  return {
    results,
    totalMatches: state.totalMatches,
    truncated: state.totalMatches > (query.maxResults ?? 500),
  };
}