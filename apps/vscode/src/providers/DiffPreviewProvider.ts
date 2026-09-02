import * as vscode from 'vscode';

export class BrudCodePreviewProvider
  implements vscode.TextDocumentContentProvider
{
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private _contentMap = new Map<string, string>();

  get onDidChange() {
    return this._onDidChange.event;
  }

  public setContent(uri: vscode.Uri, content: string) {
    this._contentMap.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._contentMap.get(uri.toString()) || '';
  }
}
