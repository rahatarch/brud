import * as path from 'path';
import type { ValidationResult } from '../api/types';
import { BrudAPI } from '../api/index';

export type WorkspacePathResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: string };

function isWithinWorkspaceFolder(inputPath: string, workspaceFolder: string): boolean {
  const relative = path.relative(workspaceFolder, inputPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function getWorkspaceRootForPath(targetPath: string, workspaceFolders: string[]): string | null {
  const normalized = path.resolve(targetPath);
  for (const root of workspaceFolders) {
    const resolvedRoot = path.resolve(root);
    if (isWithinWorkspaceFolder(normalized, resolvedRoot)) {
      return resolvedRoot;
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