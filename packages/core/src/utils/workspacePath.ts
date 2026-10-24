import * as fs from 'fs';
import * as path from 'path';
import type { ValidationResult } from '../api/types';
import { BrudAPI } from '../api/index';

export type WorkspacePathResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: string };

export interface PathCache {
  readonly hits: number;
  readonly misses: number;
  canonicalize(input: string): string;
  isWithin(inputPath: string, folder: string): boolean;
}

interface RealPathResolution {
  value: string;
  exists: boolean;
}

function resolveNearestRealPath(target: string): RealPathResolution {
  const resolved = path.resolve(target);
  const missing: string[] = [];
  let current = resolved;

  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return {
        value: missing.length === 0 ? real : path.join(real, ...missing.reverse()),
        exists: missing.length === 0,
      };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return { value: resolved, exists: false };
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isWithinRelative(relative: string): boolean {
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function containment(inputPath: string, folder: string): boolean {
  return isWithinRelative(path.relative(resolveNearestRealPath(folder).value, resolveNearestRealPath(inputPath).value));
}

export function createPathCache(): PathCache {
  const canonicalPaths = new Map<string, string>();
  const containmentResults = new Map<string, boolean>();
  let hits = 0;
  let misses = 0;

  function memoized(input: string): string {
    const cached = canonicalPaths.get(input);
    if (cached !== undefined) {
      return cached;
    }
    const resolution = resolveNearestRealPath(input);
    if (resolution.exists) {
      canonicalPaths.set(input, resolution.value);
    }
    return resolution.value;
  }

  return {
    get hits(): number {
      return hits;
    },
    get misses(): number {
      return misses;
    },

    canonicalize(input: string): string {
      const cached = canonicalPaths.get(input);
      if (cached !== undefined) {
        hits++;
        return cached;
      }
      misses++;
      return memoized(input);
    },

    isWithin(inputPath: string, folder: string): boolean {
      const key = `${inputPath}::${folder}`;
      const cached = containmentResults.get(key);
      if (cached !== undefined) {
        hits++;
        return cached;
      }
      misses++;
      const within = isWithinRelative(path.relative(memoized(folder), memoized(inputPath)));
      containmentResults.set(key, within);
      return within;
    },
  };
}

function nearestRealPath(target: string, cache?: PathCache): string {
  return cache ? cache.canonicalize(target) : resolveNearestRealPath(target).value;
}

export function canonicalizeWorkspacePath(target: string, cache?: PathCache): string {
  return nearestRealPath(target, cache);
}

export function isWithinWorkspaceFolder(inputPath: string, workspaceFolder: string, cache?: PathCache): boolean {
  if (cache) {
    return cache.isWithin(inputPath, workspaceFolder);
  }
  return containment(inputPath, workspaceFolder);
}

export function getWorkspaceRootForPath(targetPath: string, workspaceFolders: string[], cache?: PathCache): string | null {
  for (const root of workspaceFolders) {
    const resolvedRoot = path.resolve(root);
    if (path.isAbsolute(targetPath)) {
      if (isWithinWorkspaceFolder(path.resolve(targetPath), resolvedRoot, cache)) {
        return resolvedRoot;
      }
    } else {
      const candidate = path.resolve(resolvedRoot, targetPath);
      if (isWithinWorkspaceFolder(candidate, resolvedRoot, cache)) {
        return resolvedRoot;
      }
    }
  }
  return null;
}

export function validateWorkspacePathWithCode(
  inputPath: string,
  workspaceFolders: string[],
  cache?: PathCache
): ValidationResult {
  return BrudAPI.validate.path(inputPath, workspaceFolders, cache ? { cache } : undefined);
}

export function validateWorkspacePath(
  inputPath: string,
  workspaceFolders: string[],
  cache?: PathCache
): WorkspacePathResult {
  const result = BrudAPI.validate.path(inputPath, workspaceFolders, cache ? { cache } : undefined);
  if (!result.success) {
    return { valid: false, error: result.friendly || result.details || 'Unknown error' };
  }
  const data = result.data as { resolvedPath?: string } | undefined;
  return { valid: true, resolvedPath: data?.resolvedPath ?? path.resolve(inputPath) };
}
