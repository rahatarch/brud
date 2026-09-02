import * as path from 'path';

export type WorkspacePathResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: string };

export function validateWorkspacePath(
  inputPath: string,
  workspaceFolders: string[]
): WorkspacePathResult {
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { valid: false, error: 'No workspace is currently open. Open a folder in VS Code to use file operations.' };
  }

  if (path.isAbsolute(inputPath)) {
    const resolvedPath = path.resolve(inputPath);

    for (const workspaceFolder of workspaceFolders) {
      const relativePath = path.relative(workspaceFolder, resolvedPath);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return { valid: true, resolvedPath };
      }
    }

    return { valid: false, error: 'The path "' + inputPath + '" is outside the current workspace. File operations are restricted to files and folders inside the workspace.' };
  }

  for (const workspaceFolder of workspaceFolders) {
    const candidatePath = path.resolve(workspaceFolder, inputPath);
    const relativePath = path.relative(workspaceFolder, candidatePath);
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
      return { valid: true, resolvedPath: candidatePath };
    }
  }

  return { valid: false, error: 'The path "' + inputPath + '" is outside the current workspace. File operations are restricted to files and folders inside the workspace.' };
}