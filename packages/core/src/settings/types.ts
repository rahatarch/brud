export const MAX_BATCH_FILES = 100;
export const MAX_AGGREGATE_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_AGGREGATE_BYTES = 32 * 1024 * 1024;
export const MAX_READ_CONCURRENCY = 32;
export const DEFAULT_READ_CONCURRENCY = 16;
export const BINARY_SAMPLE_BYTES = 8192;

export interface BrudSettings {
  workspaceBoundaryEnabled: boolean;
  commandValidationEnabled: boolean;
  toolAllowList: Record<string, boolean>;
  mcpAutoOn?: boolean;
  readConcurrency?: number;
  readMaxBatchFiles?: number;
  readMaxAggregateBytes?: number;
}

export const DEFAULT_SETTINGS: BrudSettings = {
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: {},
  mcpAutoOn: true,
  readConcurrency: DEFAULT_READ_CONCURRENCY,
  readMaxBatchFiles: MAX_BATCH_FILES,
  readMaxAggregateBytes: MAX_AGGREGATE_BYTES,
};

export interface SettingsLoadResult {
  settings: BrudSettings;
  source: 'default' | 'vscode-global' | 'vscode-workspace' | 'brud-json';
  warnings: string[];
}
