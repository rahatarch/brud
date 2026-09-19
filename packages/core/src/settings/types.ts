export interface BrudSettings {
  workspaceBoundaryEnabled: boolean;
  toolAllowList: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: BrudSettings = {
  workspaceBoundaryEnabled: true,
  toolAllowList: {},
};

export interface SettingsLoadResult {
  settings: BrudSettings;
  source: 'default' | 'vscode-global' | 'vscode-workspace' | 'brud-json';
  warnings: string[];
}