import * as vscode from 'vscode';
import { FileSystem } from '@brud/core';

export class VSCodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    const uri = vscode.Uri.file(path);
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }

  async deleteFile(path: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.workspace.fs.delete(uri);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const fromUri = vscode.Uri.file(from);
    const toUri = vscode.Uri.file(to);
    await vscode.workspace.fs.rename(fromUri, toUri);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const fromUri = vscode.Uri.file(from);
    const toUri = vscode.Uri.file(to);
    await vscode.workspace.fs.copy(fromUri, toUri);
  }

  async exists(path: string): Promise<boolean> {
    const uri = vscode.Uri.file(path);
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  async createDirectory(path: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.workspace.fs.createDirectory(uri);
  }
}