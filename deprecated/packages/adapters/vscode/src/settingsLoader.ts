import * as fs from 'fs';
import * as path from 'path';
import type { BrudSettings } from '@brud/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeSettings(value: Record<string, unknown>): Partial<BrudSettings> {
  const settings: Partial<BrudSettings> = {};
  if (typeof value.workspaceBoundaryEnabled === 'boolean') {
    settings.workspaceBoundaryEnabled = value.workspaceBoundaryEnabled;
  }
  if (typeof value.commandValidationEnabled === 'boolean') {
    settings.commandValidationEnabled = value.commandValidationEnabled;
  }
  if (typeof value.mcpAutoOn === 'boolean') {
    settings.mcpAutoOn = value.mcpAutoOn;
  }
  if (typeof value.readConcurrency === 'number') {
    settings.readConcurrency = value.readConcurrency;
  }
  if (typeof value.readMaxBatchFiles === 'number') {
    settings.readMaxBatchFiles = value.readMaxBatchFiles;
  }
  if (typeof value.readMaxAggregateBytes === 'number') {
    settings.readMaxAggregateBytes = value.readMaxAggregateBytes;
  }
  if (isRecord(value.toolAllowList)) {
    const allowList: Record<string, boolean> = {};
    for (const [key, allowed] of Object.entries(value.toolAllowList)) {
      if (typeof allowed === 'boolean') {
        allowList[key] = allowed;
      }
    }
    settings.toolAllowList = allowList;
  }
  return settings;
}

export async function loadBrudSettings(workspaceRoot: string): Promise<Partial<BrudSettings>> {
  const settingsPath = path.join(workspaceRoot, '.brud', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) {
      return {};
    }
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      console.warn(`[brud] .brud/settings.json is not a valid object. Ignoring.`);
      return {};
    }
    return sanitizeSettings(parsed);
  } catch (err) {
    console.warn(`[brud] Failed to read .brud/settings.json:`, err);
    return {};
  }
}

export async function saveBrudSettings(workspaceRoot: string, settings: Partial<BrudSettings>): Promise<void> {
  const brudDir = path.join(workspaceRoot, '.brud');
  const settingsPath = path.join(brudDir, 'settings.json');
  if (!fs.existsSync(brudDir)) {
    fs.mkdirSync(brudDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}