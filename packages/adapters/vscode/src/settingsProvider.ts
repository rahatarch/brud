import * as vscode from 'vscode';
import * as path from 'path';
import { mergeSettings, DEFAULT_SETTINGS } from '@brud/core';
import type { BrudSettings, SettingsLoadResult } from '@brud/core';
import { loadBrudSettings } from './settingsLoader';

export async function getEffectiveSettings(workspaceRoot: string): Promise<SettingsLoadResult> {
  console.log('[settingsProvider] Loading effective settings for:', workspaceRoot);
  const globalConfig = vscode.workspace.getConfiguration('brud', null);
  const globalSettings: Partial<BrudSettings> = {};
  const globalBoundary = globalConfig.inspect<boolean>('workspaceBoundaryEnabled');
  const globalAllowList = globalConfig.inspect<Record<string, boolean>>('toolAllowList');
  if (globalBoundary?.globalValue !== undefined) {
    globalSettings.workspaceBoundaryEnabled = globalBoundary.globalValue;
  }
  if (globalAllowList?.globalValue !== undefined) {
    globalSettings.toolAllowList = globalAllowList.globalValue;
  }

  let workspaceSettings: Partial<BrudSettings> = {};
  const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceFolderUri) {
    const workspaceConfig = vscode.workspace.getConfiguration('brud', workspaceFolderUri);
    const wsBoundary = workspaceConfig.inspect<boolean>('workspaceBoundaryEnabled');
    const wsAllowList = workspaceConfig.inspect<Record<string, boolean>>('toolAllowList');
    if (wsBoundary?.workspaceValue !== undefined) {
      workspaceSettings.workspaceBoundaryEnabled = wsBoundary.workspaceValue;
    }
    if (wsAllowList?.workspaceValue !== undefined) {
      workspaceSettings.toolAllowList = wsAllowList.workspaceValue;
    }
  }

  const brudJsonSettings = await loadBrudSettings(workspaceRoot);
  const brudJsonHasKeys = Object.keys(brudJsonSettings).length > 0;

  const { settings, warnings } = mergeSettings(globalSettings, workspaceSettings, brudJsonSettings);

  let source: SettingsLoadResult['source'];
  if (brudJsonHasKeys) {
    source = 'brud-json';
  } else if (Object.keys(workspaceSettings).length > 0) {
    source = 'vscode-workspace';
  } else if (Object.keys(globalSettings).length > 0) {
    source = 'vscode-global';
  } else {
    source = 'default';
  }

  console.log('[settingsProvider] Returning with source:', source);
  return { settings, source, warnings };
}