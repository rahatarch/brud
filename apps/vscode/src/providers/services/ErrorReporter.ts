import * as vscode from 'vscode';
import { BrudError } from '@brud/core';
import type { ValidationResult } from '@brud/core';
import type { ExtensionMessage, ReportSection } from '@brud/protocol';

export type ErrorInput =
  | string
  | { code: string; friendly: string; details: string; path?: string; command?: string }
  | ValidationResult;

export class ErrorReporter {
  constructor(
    private getWebview: () => vscode.Webview | undefined,
    private getUnifiedResultsPanelManager: () => any,
    private outputChannel: vscode.OutputChannel,
  ) {}

  generateErrorReport(error: ErrorInput): ReportSection[] {
    const sections: ReportSection[] = [];

    let friendlyMessage: string;
    let detailMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
      detailMessage = error;
    } else {
      friendlyMessage = error.friendly || 'Something went wrong. Here are the details:';
      detailMessage = error.details || friendlyMessage;
    }

    if (detailMessage !== friendlyMessage) {
      sections.push({ type: 'details', title: 'Error Details', content: detailMessage });
    }
    sections.push({ type: 'button', buttonText: 'See Details', buttonAction: 'openUnifiedResults' });

    return sections;
  }

  sendError(error: ErrorInput): void {
    const structured = this.generateErrorReport(error);
    let friendlyMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
    } else {
      friendlyMessage = error.friendly || 'Something went wrong.';
    }

    this.getUnifiedResultsPanelManager()?.openUnifiedResultsPanel({
      operations: [{
        toolKind: 'error',
        data: { structured, friendlyMessage },
      }],
    });

    const webview = this.getWebview();
    if (webview) {
      const msg: ExtensionMessage = { command: 'error', message: 'Failed. Check the report at the Report Panel.' };
      webview.postMessage(msg);
    }
    this.outputChannel.appendLine('ERROR: ' + friendlyMessage);
  }

  sendParseError(error: string | BrudError | ValidationResult): void {
    const structured = this.generateErrorReport(error);
    structured.push({ type: 'button', buttonText: 'Go to Prompt Library', buttonAction: 'openPromptLibrary' });

    let friendlyMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
    } else {
      friendlyMessage = error.friendly || 'I couldn\'t understand the format of your message.';
    }

    this.getUnifiedResultsPanelManager()?.openUnifiedResultsPanel({
      operations: [{
        toolKind: 'error',
        data: { structured, friendlyMessage },
      }],
    });

    const webview = this.getWebview();
    if (webview) {
      const msg: ExtensionMessage = { command: 'error', message: 'Failed. Check the report at the Report Panel.' };
      webview.postMessage(msg);
    }
    this.outputChannel.appendLine('ERROR: ' + friendlyMessage);
  }
}