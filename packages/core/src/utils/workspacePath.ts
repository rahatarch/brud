import * as fs from 'fs';
import * as path from 'path';
import type { ValidationResult } from '../api/types';
import { BrudAPI } from '../api/index';

export type WorkspacePathResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: string };

function nearestRealPath(target: string): string {
  const resolved = path.resolve(target);
  const missing: string[] = [];
  let current = resolved;

  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return missing.length === 0 ? real : path.join(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export function canonicalizeWorkspacePath(target: string): string {
  return nearestRealPath(target);
}

export function isWithinWorkspaceFolder(inputPath: string, workspaceFolder: string): boolean {
  const relative = path.relative(nearestRealPath(workspaceFolder), nearestRealPath(inputPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function getWorkspaceRootForPath(targetPath: string, workspaceFolders: string[]): string | null {
  for (const root of workspaceFolders) {
    const resolvedRoot = path.resolve(root);
    if (path.isAbsolute(targetPath)) {
      if (isWithinWorkspaceFolder(path.resolve(targetPath), resolvedRoot)) {
        return resolvedRoot;
      }
    } else {
      const candidate = path.resolve(resolvedRoot, targetPath);
      if (isWithinWorkspaceFolder(candidate, resolvedRoot)) {
        return resolvedRoot;
      }
    }
  }
  return null;
}

export function validateWorkspacePathWithCode(
  inputPath: string,
  workspaceFolders: string[]
): ValidationResult {
  return BrudAPI.validate.path(inputPath, workspaceFolders);
}

export function validateWorkspacePath(
  inputPath: string,
  workspaceFolders: string[]
): WorkspacePathResult {
  const result = BrudAPI.validate.path(inputPath, workspaceFolders);
  if (!result.success) {
    return { valid: false, error: result.friendly || result.details || 'Unknown error' };
  }
  const data = result.data as { resolvedPath?: string } | undefined;
  return { valid: true, resolvedPath: data?.resolvedPath ?? path.resolve(inputPath) };
}