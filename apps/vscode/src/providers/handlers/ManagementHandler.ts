import * as vscode from 'vscode';

export class ManagementHandler {
  public async handle(): Promise<void> {
    vscode.commands.executeCommand('brud.openManagement');
  }
}