import * as path from 'path';

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

export function validateWorkspacePath(
  inputPath: string,
  workspaceFolders: string[]
): WorkspacePathResult {
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { valid: false, error: 'No workspace is currently open. Open a folder in VS Code to use file operations.' };
  }

  if (path.isAbsolute(inputPath)) {
    const resolved = path.resolve(inputPath);
    for (const folder of workspaceFolders) {
      if (isWithinWorkspaceFolder(resolved, path.resolve(folder))) {
        return { valid: true, resolvedPath: resolved };
      }
    }
    return { valid: false, error: 'The path "' + inputPath + '" is outside the current workspace. File operations are restricted to files and folders inside the workspace.' };
  }

  for (const folder of workspaceFolders) {
    const resolvedRoot = path.resolve(folder);
    const candidate = path.resolve(resolvedRoot, inputPath);
    if (isWithinWorkspaceFolder(candidate, resolvedRoot)) {
      return { valid: true, resolvedPath: candidate };
    }
  }

  return { valid: false, error: 'The path "' + inputPath + '" is outside the current workspace. File operations are restricted to files and folders inside the workspace.' };
}