import * as path from 'path';
import { validateWorkspacePath, getWorkspaceRootForPath } from './workspacePath.js';

export interface WorkspacePathResolver {
  resolveToAbsolute(inputPath: string, workspaceFolders: string[]): string | null;
  toRelativePath(absolutePath: string, workspaceFolders: string[]): string;
  isWithinWorkspace(path: string, workspaceFolders: string[]): boolean;
  normalizePath(path: string): string;
  resolveUserPath(inputPath: string, workspaceFolders: string[]): { absolute: string; relative: string } | null;
}

export function createPathResolver(): WorkspacePathResolver {
  return {
    resolveToAbsolute(inputPath: string, workspaceFolders: string[]): string | null {
      const result = validateWorkspacePath(inputPath, workspaceFolders);
      if (!result.valid) {
        return null;
      }
      return result.resolvedPath;
    },

    toRelativePath(absolutePath: string, workspaceFolders: string[]): string {
      const result = validateWorkspacePath(absolutePath, workspaceFolders);
      if (!result.valid) {
        return absolutePath;
      }
      const root = getWorkspaceRootForPath(absolutePath, workspaceFolders);
      if (root) {
        return path.relative(root, absolutePath);
      }
      return absolutePath;
    },

    isWithinWorkspace(targetPath: string, workspaceFolders: string[]): boolean {
      return validateWorkspacePath(targetPath, workspaceFolders).valid;
    },

    normalizePath(inputPath: string): string {
      let normalized = inputPath.replace(/\\/g, '/');
      normalized = path.normalize(normalized);
      if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      if (normalized.length > 1 && normalized.endsWith('\\')) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    },

    resolveUserPath(inputPath: string, workspaceFolders: string[]): { absolute: string; relative: string } | null {
      const result = validateWorkspacePath(inputPath, workspaceFolders);
      if (!result.valid) {
        return null;
      }
      const relative = this.toRelativePath(result.resolvedPath, workspaceFolders);
      return { absolute: result.resolvedPath, relative };
    },
  };
}