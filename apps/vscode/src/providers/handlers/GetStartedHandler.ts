import * as vscode from 'vscode';

export class GetStartedHandler {
  public async handle(): Promise<void> {
    vscode.commands.executeCommand('brud.getStarted');
  }
}