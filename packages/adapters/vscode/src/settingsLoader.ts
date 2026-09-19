import * as fs from 'fs';
import * as path from 'path';
import type { BrudSettings } from '@brud/core';

export async function loadBrudSettings(workspaceRoot: string): Promise<Partial<BrudSettings>> {
  const settingsPath = path.join(workspaceRoot, '.brud', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) {
      return {};
    }
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn(`[brud] .brud/settings.json is not a valid object. Ignoring.`);
      return {};
    }
    return parsed as Partial<BrudSettings>;
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