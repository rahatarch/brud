import * as path from 'path';
import * as vscode from 'vscode';

export type WorkspacePathResult =
  | { valid: true; uri: vscode.Uri }
  | { valid: false; error: string };

/**
 * Validates that a file path is within one of the currently open workspace folders.
 * Returns a result object with either the valid Uri or an error message.
 */
export function validateWorkspacePath(inputPath: string): WorkspacePathResult {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return { valid: false, error: 'No workspace is currently open. Open a folder in VS Code to use file operations.' };
  }

  const resolvedPath = path.resolve(inputPath);
  const fileUri = vscode.Uri.file(resolvedPath);

  for (const workspaceFolder of vscode.workspace.workspaceFolders) {
    const relativePath = path.relative(workspaceFolder.uri.fsPath, resolvedPath);
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
      return { valid: true, uri: fileUri };
    }
  }

  return { valid: false, error: 'The path "' + resolvedPath + '" is outside the current workspace. File operations are restricted to files and folders inside the workspace.' };
}