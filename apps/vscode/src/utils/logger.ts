import * as vscode from 'vscode';

/**
 * Singleton Logger Utility for Brud.
 * Encapsulates the VS Code OutputChannel for centralized diagnostic logging.
 */
export class BrudLogger {
  private static _instance: BrudLogger;
  private _outputChannel: vscode.OutputChannel;

  private constructor() {
    this._outputChannel = vscode.window.createOutputChannel(
      'Brud Debug',
    );
  }

  public static getInstance(): BrudLogger {
    if (!BrudLogger._instance) {
      BrudLogger._instance = new BrudLogger();
    }
    return BrudLogger._instance;
  }

  public appendLine(message: string) {
    this._outputChannel.appendLine(
      `[${new Date().toLocaleTimeString()}] ${message}`,
    );
  }

  public show() {
    this._outputChannel.show(true);
  }

  public get channel(): vscode.OutputChannel {
    return this._outputChannel;
  }
}
