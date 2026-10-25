import type {
  ConfigScope,
  PluginRolloutMode,
  SettingsSnapshot,
  SettingsWarning,
} from '../contracts/ISettingsService.js';
import { deepFreeze } from './deepFreeze.js';

/** Current settings document schema version. */
export const SETTINGS_SCHEMA_VERSION = 1 as const;

/** Lowest accepted read concurrency. */
export const READ_CONCURRENCY_MIN = 1;

/** Highest accepted read concurrency. */
export const READ_CONCURRENCY_MAX = 32;

/** Lowest accepted batch size for a read operation. */
export const READ_MAX_BATCH_FILES_MIN = 1;

/** Highest accepted batch size for a read operation. */
export const READ_MAX_BATCH_FILES_MAX = 100;

/** Lowest accepted aggregate byte budget for a read operation. */
export const READ_MAX_AGGREGATE_BYTES_MIN = 1;

/** Highest accepted aggregate byte budget (hard ceiling). */
export const READ_MAX_AGGREGATE_BYTES_MAX = 32 * 1024 * 1024;

/** Default read concurrency. */
export const DEFAULT_READ_CONCURRENCY = 16;

/** Default batch size for a read operation. */
export const DEFAULT_READ_MAX_BATCH_FILES = 100;

/** Default aggregate byte budget for a read operation. */
export const DEFAULT_READ_MAX_AGGREGATE_BYTES = 8 * 1024 * 1024;

/** Supported plugin rollout modes. */
export const PLUGIN_ROLLOUT_MODES: readonly PluginRolloutMode[] = deepFreeze([
  'off',
  'shadow',
  'active',
]);

/** Rollout lattice ordering: `off < shadow < active`. */
export const PLUGIN_ROLLOUT_ORDER: Readonly<Record<PluginRolloutMode, number>> = deepFreeze({
  off: 0,
  shadow: 1,
  active: 2,
});

/** Rollout level assumed when no layer declares one. */
export const DEFAULT_PLUGIN_ROLLOUT_MODE: PluginRolloutMode = 'active';

/** Fields that make up a snapshot without the fixed schema version. */
export type SettingsValues = Omit<SettingsSnapshot, 'schemaVersion'>;

/**
 * Builds a deep-frozen snapshot from plain values.
 *
 * The mutable maps are copied before freezing so callers never freeze their
 * own input object.
 *
 * @param values - Snapshot values.
 * @returns A deep-frozen snapshot.
 */
export function createSettingsSnapshot(values: SettingsValues): SettingsSnapshot {
  return deepFreeze<SettingsSnapshot>({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    workspaceBoundaryEnabled: values.workspaceBoundaryEnabled,
    commandValidationEnabled: values.commandValidationEnabled,
    toolAllowList: { ...values.toolAllowList },
    readConcurrency: values.readConcurrency,
    readMaxBatchFiles: values.readMaxBatchFiles,
    readMaxAggregateBytes: values.readMaxAggregateBytes,
    plugins: { ...values.plugins },
  });
}

/**
 * Ratified default policy.
 *
 * Both safety keys are enabled by default and can only be relaxed by the
 * trusted user scope, never by a workspace document.
 */
export const DEFAULT_SETTINGS: SettingsSnapshot = createSettingsSnapshot({
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: {},
  readConcurrency: DEFAULT_READ_CONCURRENCY,
  readMaxBatchFiles: DEFAULT_READ_MAX_BATCH_FILES,
  readMaxAggregateBytes: DEFAULT_READ_MAX_AGGREGATE_BYTES,
  plugins: {},
});

/** Result of sanitizing one scope document. */
export interface SanitizedSettingsDocument {
  readonly values: Partial<SettingsSnapshot>;
  readonly warnings: readonly SettingsWarning[];
}

interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidWarning(scope: ConfigScope, field: string, reason: string): SettingsWarning {
  return {
    code: 'INVALID_FIELD',
    scope,
    field,
    message: `Ignoring "${field}" in "${scope}" settings: ${reason}.`,
  };
}

function readBoolean(
  record: Record<string, unknown>,
  field: string,
  scope: ConfigScope,
  warnings: SettingsWarning[],
): boolean | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    warnings.push(invalidWarning(scope, field, 'expected a boolean'));
    return undefined;
  }

  return value;
}

function readInteger(
  record: Record<string, unknown>,
  field: string,
  scope: ConfigScope,
  range: IntegerRange,
  warnings: SettingsWarning[],
): number | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(invalidWarning(scope, field, 'expected a finite number'));
    return undefined;
  }

  const integer = Math.floor(value);
  const clamped = Math.min(range.max, Math.max(range.min, integer));

  if (clamped !== integer) {
    warnings.push({
      code: 'VALUE_CLAMPED',
      scope,
      field,
      message: `Clamped "${field}" in "${scope}" settings to ${clamped} (allowed ${range.min}..${range.max}).`,
    });
  }

  return clamped;
}

function readToolAllowList(
  record: Record<string, unknown>,
  scope: ConfigScope,
  warnings: SettingsWarning[],
): Readonly<Record<string, boolean>> | undefined {
  const value = record.toolAllowList;

  if (value === undefined) {
    return undefined;
  }

  if (!isPlainRecord(value)) {
    warnings.push(invalidWarning(scope, 'toolAllowList', 'expected an object of booleans'));
    return undefined;
  }

  const allowList: Record<string, boolean> = {};

  for (const [tool, enabled] of Object.entries(value)) {
    if (typeof enabled !== 'boolean') {
      warnings.push(invalidWarning(scope, `toolAllowList.${tool}`, 'expected a boolean'));
      continue;
    }

    allowList[tool] = enabled;
  }

  return allowList;
}

function readPluginModes(
  record: Record<string, unknown>,
  scope: ConfigScope,
  warnings: SettingsWarning[],
): Readonly<Record<string, PluginRolloutMode>> | undefined {
  const value = record.plugins;

  if (value === undefined) {
    return undefined;
  }

  if (!isPlainRecord(value)) {
    warnings.push(invalidWarning(scope, 'plugins', 'expected an object of rollout modes'));
    return undefined;
  }

  const plugins: Record<string, PluginRolloutMode> = {};

  for (const [pluginId, mode] of Object.entries(value)) {
    if (typeof mode !== 'string' || !PLUGIN_ROLLOUT_MODES.includes(mode as PluginRolloutMode)) {
      warnings.push(invalidWarning(scope, `plugins.${pluginId}`, 'expected "off", "shadow", or "active"'));
      continue;
    }

    plugins[pluginId] = mode as PluginRolloutMode;
  }

  return plugins;
}

/**
 * Validates one parsed settings document field by field.
 *
 * Invalid values are dropped and reported as warnings; unknown keys are
 * retained on disk by the write path but are never projected into the typed
 * snapshot.
 *
 * @param document - Parsed JSON value for a scope.
 * @param scope - Scope the document was read from.
 * @returns Validated fields and structured warnings.
 */
export function sanitizeSettingsDocument(
  document: unknown,
  scope: ConfigScope,
): SanitizedSettingsDocument {
  const warnings: SettingsWarning[] = [];

  if (!isPlainRecord(document)) {
    warnings.push(invalidWarning(scope, 'document', 'expected a JSON object'));
    return { values: {}, warnings };
  }

  const values: {
    workspaceBoundaryEnabled?: boolean;
    commandValidationEnabled?: boolean;
    toolAllowList?: Readonly<Record<string, boolean>>;
    readConcurrency?: number;
    readMaxBatchFiles?: number;
    readMaxAggregateBytes?: number;
    plugins?: Readonly<Record<string, PluginRolloutMode>>;
  } = {};

  const schemaVersion = document.schemaVersion;

  if (schemaVersion !== undefined && schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    warnings.push({
      code: 'INVALID_FIELD',
      scope,
      field: 'schemaVersion',
      message: `Unsupported "schemaVersion" in "${scope}" settings; expected ${SETTINGS_SCHEMA_VERSION}.`,
    });
  }

  const boundary = readBoolean(document, 'workspaceBoundaryEnabled', scope, warnings);

  if (boundary !== undefined) {
    values.workspaceBoundaryEnabled = boundary;
  }

  const commandValidation = readBoolean(document, 'commandValidationEnabled', scope, warnings);

  if (commandValidation !== undefined) {
    values.commandValidationEnabled = commandValidation;
  }

  const toolAllowList = readToolAllowList(document, scope, warnings);

  if (toolAllowList !== undefined) {
    values.toolAllowList = toolAllowList;
  }

  const concurrency = readInteger(
    document,
    'readConcurrency',
    scope,
    { min: READ_CONCURRENCY_MIN, max: READ_CONCURRENCY_MAX },
    warnings,
  );

  if (concurrency !== undefined) {
    values.readConcurrency = concurrency;
  }

  const batchFiles = readInteger(
    document,
    'readMaxBatchFiles',
    scope,
    { min: READ_MAX_BATCH_FILES_MIN, max: READ_MAX_BATCH_FILES_MAX },
    warnings,
  );

  if (batchFiles !== undefined) {
    values.readMaxBatchFiles = batchFiles;
  }

  const aggregateBytes = readInteger(
    document,
    'readMaxAggregateBytes',
    scope,
    { min: READ_MAX_AGGREGATE_BYTES_MIN, max: READ_MAX_AGGREGATE_BYTES_MAX },
    warnings,
  );

  if (aggregateBytes !== undefined) {
    values.readMaxAggregateBytes = aggregateBytes;
  }

  const plugins = readPluginModes(document, scope, warnings);

  if (plugins !== undefined) {
    values.plugins = plugins;
  }

  return { values, warnings };
}
