import * as vscode from 'vscode';

export function getWorkspaceFolders(): string[] {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }
  return vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath);
}

export function getWorkspaceFolderUris(): vscode.Uri[] {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }
  return vscode.workspace.workspaceFolders.map(folder => folder.uri);
}