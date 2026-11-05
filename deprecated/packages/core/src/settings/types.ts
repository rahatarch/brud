import {
  BINARY_SAMPLE_BYTES,
  DEFAULT_READ_CONCURRENCY,
  HARD_MAX_AGGREGATE_BYTES,
  MAX_AGGREGATE_BYTES,
  MAX_BATCH_FILES,
  MAX_READ_CONCURRENCY,
} from './ceiling-source';

export {
  BINARY_SAMPLE_BYTES,
  DEFAULT_READ_CONCURRENCY,
  HARD_MAX_AGGREGATE_BYTES,
  MAX_AGGREGATE_BYTES,
  MAX_BATCH_FILES,
  MAX_READ_CONCURRENCY,
};

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
