export interface BrudSettings {
  workspaceBoundaryEnabled: boolean;
  commandValidationEnabled: boolean;
  toolAllowList: Record<string, boolean>;
  mcpAutoOn?: boolean;
}

export const DEFAULT_SETTINGS: BrudSettings = {
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: {},
  mcpAutoOn: true,
};

export interface SettingsLoadResult {
  settings: BrudSettings;
  source: 'default' | 'vscode-global' | 'vscode-workspace' | 'brud-json';
  warnings: string[];
}