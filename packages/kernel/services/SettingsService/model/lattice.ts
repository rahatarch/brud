import type {
  ConfigScope,
  PluginRolloutMode,
  SettingsSnapshot,
  SettingsWarning,
} from '../contracts/ISettingsService.js';
import {
  DEFAULT_PLUGIN_ROLLOUT_MODE,
  DEFAULT_SETTINGS,
  PLUGIN_ROLLOUT_ORDER,
  READ_CONCURRENCY_MAX,
  READ_CONCURRENCY_MIN,
  READ_MAX_AGGREGATE_BYTES_MAX,
  READ_MAX_AGGREGATE_BYTES_MIN,
  READ_MAX_BATCH_FILES_MAX,
  READ_MAX_BATCH_FILES_MIN,
  HISTORY_MIN_UNDO_ENTRIES_MAX,
  HISTORY_RETENTION_DAYS_MAX,
  createSettingsSnapshot,
} from './defaults.js';

/**
 * Retention keys. Their lattice is reversed: keeping more history is safer,
 * so the join (maximum) wins and any value below the default is a loosening.
 */
export const RETENTION_KEYS = ['historyRetentionDays', 'historyMinUndoEntries'] as const;

/** One of the retention keys. */
export type RetentionKey = (typeof RETENTION_KEYS)[number];

const RETENTION_CEILINGS: Readonly<Record<RetentionKey, number>> = {
  historyRetentionDays: HISTORY_RETENTION_DAYS_MAX,
  historyMinUndoEntries: HISTORY_MIN_UNDO_ENTRIES_MAX,
};

/** Policy keys that follow the monotonic safety lattice. */
export const SAFETY_KEYS = [
  'workspaceBoundaryEnabled',
  'commandValidationEnabled',
] as const;

/** One of the monotonic safety policy keys. */
export type SafetyKey = (typeof SAFETY_KEYS)[number];

/** Writable view of a settings patch used internally by the merge logic. */
export type MutableSettingsPatch = {
  -readonly [K in keyof SettingsSnapshot]?: SettingsSnapshot[K];
};

/** Inputs to {@link evaluateLattice}. */
export interface LatticeInput {
  /** Trusted user-scope overrides. */
  readonly user?: Partial<SettingsSnapshot>;
  /** Workspace-scope overrides, which may only tighten safety policy. */
  readonly workspace?: Partial<SettingsSnapshot>;
  /** Base policy. Defaults to {@link DEFAULT_SETTINGS}. */
  readonly defaults?: SettingsSnapshot;
}

/** Result of resolving the three settings layers. */
export interface LatticeResult {
  readonly snapshot: SettingsSnapshot;
  readonly warnings: readonly SettingsWarning[];
}

/** Inputs describing the higher-trust layers used to validate a patch. */
export interface LatticePatchInput {
  readonly user?: Partial<SettingsSnapshot>;
  readonly defaults?: SettingsSnapshot;
}

/** Result of filtering a workspace patch through the safety lattice. */
export interface LatticePatchResult {
  readonly patch: MutableSettingsPatch;
  readonly warnings: readonly SettingsWarning[];
}

interface EffectiveSettings {
  workspaceBoundaryEnabled: boolean;
  commandValidationEnabled: boolean;
  toolAllowList: Record<string, boolean>;
  readConcurrency: number;
  readMaxBatchFiles: number;
  readMaxAggregateBytes: number;
  plugins: Record<string, PluginRolloutMode>;
  historyRetentionDays: number;
  historyMinUndoEntries: number;
}

function clampGovernor(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function looseningWarning(
  field: string,
  detail: string,
  scope: ConfigScope = 'workspace',
): SettingsWarning {
  return {
    code: 'SAFETY_LOOSENING_IGNORED',
    scope,
    field,
    message: `SAFETY_LOOSENING_IGNORED:${field} - ${detail}`,
  };
}

function isSafetyLoosening(
  candidate: boolean | undefined,
  defaultValue: boolean,
  userValue: boolean | undefined,
): boolean {
  return candidate === false && (defaultValue === true || userValue === true);
}

/**
 * Meet operator ($\sqcap$) over the rollout lattice `off < shadow < active`.
 *
 * The lower level always wins, so a workspace can only reduce exposure.
 *
 * @param a - First rollout level.
 * @param b - Second rollout level.
 * @returns The more restrictive level.
 */
export function meetRollout(a: PluginRolloutMode, b: PluginRolloutMode): PluginRolloutMode {
  return PLUGIN_ROLLOUT_ORDER[a] <= PLUGIN_ROLLOUT_ORDER[b] ? a : b;
}

/**
 * Resolves the highest-trust rollout ceiling for a plugin.
 *
 * @param id - Plugin identifier.
 * @param input - Higher-trust layers.
 * @returns The most permissive level the workspace may not exceed.
 */
export function pluginCeiling(id: string, input: LatticePatchInput = {}): PluginRolloutMode {
  const defaults = input.defaults ?? DEFAULT_SETTINGS;
  const user = input.user ?? {};

  return meetRollout(
    defaults.plugins[id] ?? DEFAULT_PLUGIN_ROLLOUT_MODE,
    user.plugins?.[id] ?? DEFAULT_PLUGIN_ROLLOUT_MODE,
  );
}

/**
 * Resolves the highest-trust allow ceiling for a tool.
 *
 * `toolAllowList` is a boolean lattice ordered `true > false`, so the meet is
 * logical AND across layers. A missing key means "enabled".
 *
 * @param tool - Tool kind.
 * @param input - Higher-trust layers.
 * @returns `true` when higher-trust layers still allow the tool.
 */
export function toolCeiling(tool: string, input: LatticePatchInput = {}): boolean {
  const defaults = input.defaults ?? DEFAULT_SETTINGS;
  const user = input.user ?? {};

  return (defaults.toolAllowList[tool] ?? true) && (user.toolAllowList?.[tool] ?? true);
}

/**
 * Resolves `DEFAULT_SETTINGS ⊓ user ⊓ workspace` with the meet operator applied
 * to every capability:
 *
 * - Safety booleans: `true` (restrictive) dominates, so a workspace may only
 *   tighten a policy a higher-trust layer relaxed.
 * - `plugins`: `off < shadow < active`; the most restrictive level wins.
 * - `toolAllowList`: logical AND across layers.
 * - Read governors: `min(user, workspace)` within the ratified ranges.
 *
 * Dropped workspace relaxations are reported as `SAFETY_LOOSENING_IGNORED`
 * warnings with a `field` of `plugins.<id>` or `toolAllowList.<tool>`.
 *
 * @param input - Layer inputs.
 * @returns The frozen merged snapshot and any lattice warnings.
 */
export function evaluateLattice(input: LatticeInput = {}): LatticeResult {
  const defaults = input.defaults ?? DEFAULT_SETTINGS;
  const user = input.user ?? {};
  const workspace = input.workspace ?? {};
  const warnings: SettingsWarning[] = [];

  const effective: EffectiveSettings = {
    workspaceBoundaryEnabled: user.workspaceBoundaryEnabled ?? defaults.workspaceBoundaryEnabled,
    commandValidationEnabled:
      user.commandValidationEnabled ?? defaults.commandValidationEnabled,
    toolAllowList: {},
    readConcurrency: meetGovernor(
      defaults.readConcurrency,
      user.readConcurrency,
      workspace.readConcurrency,
    ),
    readMaxBatchFiles: meetGovernor(
      defaults.readMaxBatchFiles,
      user.readMaxBatchFiles,
      workspace.readMaxBatchFiles,
    ),
    readMaxAggregateBytes: meetGovernor(
      defaults.readMaxAggregateBytes,
      user.readMaxAggregateBytes,
      workspace.readMaxAggregateBytes,
    ),
    plugins: {},
    historyRetentionDays: defaults.historyRetentionDays,
    historyMinUndoEntries: defaults.historyMinUndoEntries,
  };

  for (const key of RETENTION_KEYS) {
    effective[key] = joinRetention(key, defaults[key], [
      ['user', user[key]],
      ['workspace', workspace[key]],
    ], warnings);
  }

  for (const key of SAFETY_KEYS) {
    const candidate = workspace[key];

    if (candidate === undefined) {
      continue;
    }

    if (isSafetyLoosening(candidate, defaults[key], user[key])) {
      warnings.push(looseningWarning(
        key,
        `workspace value for "${key}" was ignored because a higher-trust layer enables it; change the user-level setting instead`,
      ));
      continue;
    }

    effective[key] = candidate;
  }

  const toolKeys = new Set([
    ...Object.keys(defaults.toolAllowList),
    ...Object.keys(user.toolAllowList ?? {}),
    ...Object.keys(workspace.toolAllowList ?? {}),
  ]);

  for (const tool of toolKeys) {
    const ceiling = toolCeiling(tool, { defaults, user });
    const candidate = workspace.toolAllowList?.[tool];

    if (candidate === true && !ceiling) {
      warnings.push(looseningWarning(
        `toolAllowList.${tool}`,
        `workspace value for "toolAllowList.${tool}" was ignored because the user scope denies the tool`,
      ));
    }

    effective.toolAllowList[tool] = ceiling && (candidate ?? true);
  }

  const pluginKeys = new Set([
    ...Object.keys(defaults.plugins),
    ...Object.keys(user.plugins ?? {}),
    ...Object.keys(workspace.plugins ?? {}),
  ]);

  for (const id of pluginKeys) {
    const ceiling = pluginCeiling(id, { defaults, user });
    const candidate = workspace.plugins?.[id];

    if (
      candidate !== undefined
      && PLUGIN_ROLLOUT_ORDER[candidate] > PLUGIN_ROLLOUT_ORDER[ceiling]
    ) {
      warnings.push(looseningWarning(
        `plugins.${id}`,
        `workspace requested "${candidate}" but the highest permitted rollout is "${ceiling}"`,
      ));
    }

    effective.plugins[id] = candidate === undefined
      ? ceiling
      : meetRollout(ceiling, candidate);
  }

  effective.readConcurrency = clampGovernor(
    effective.readConcurrency,
    defaults.readConcurrency,
    READ_CONCURRENCY_MIN,
    READ_CONCURRENCY_MAX,
  );
  effective.readMaxBatchFiles = clampGovernor(
    effective.readMaxBatchFiles,
    defaults.readMaxBatchFiles,
    READ_MAX_BATCH_FILES_MIN,
    READ_MAX_BATCH_FILES_MAX,
  );
  effective.readMaxAggregateBytes = clampGovernor(
    effective.readMaxAggregateBytes,
    defaults.readMaxAggregateBytes,
    READ_MAX_AGGREGATE_BYTES_MIN,
    READ_MAX_AGGREGATE_BYTES_MAX,
  );

  return {
    snapshot: createSettingsSnapshot(effective),
    warnings,
  };
}

/**
 * Filters a workspace-scope patch through the monotonic lattice.
 *
 * Unsafe relaxations of safety booleans, tool allow lists, and plugin rollout
 * levels are removed before the patch is written, so a workspace document
 * never persists a value the snapshot refuses to honor.
 *
 * @param patch - Sanitized workspace patch.
 * @param input - Higher-trust layers used for comparison.
 * @returns The filtered patch and any lattice warnings.
 */
export function applyLatticeToWorkspacePatch(
  patch: Partial<SettingsSnapshot>,
  input: LatticePatchInput = {},
): LatticePatchResult {
  const defaults = input.defaults ?? DEFAULT_SETTINGS;
  const user = input.user ?? {};
  const next: MutableSettingsPatch = { ...patch };
  const warnings: SettingsWarning[] = [];

  for (const key of SAFETY_KEYS) {
    const candidate = next[key];

    if (candidate === undefined) {
      continue;
    }

    if (isSafetyLoosening(candidate, defaults[key], user[key])) {
      warnings.push(looseningWarning(
        key,
        `workspace value for "${key}" was ignored because a higher-trust layer enables it`,
      ));
      delete next[key];
    }
  }

  for (const key of RETENTION_KEYS) {
    const candidate = next[key];

    if (candidate !== undefined && candidate < defaults[key]) {
      warnings.push(looseningWarning(
        key,
        `workspace value ${candidate} for "${key}" was ignored because history retention can only be raised (minimum ${defaults[key]})`,
      ));
      delete next[key];
    }
  }

  if (next.toolAllowList !== undefined) {
    const retained: Record<string, boolean> = {};

    for (const [tool, allowed] of Object.entries(next.toolAllowList)) {
      if (allowed && !toolCeiling(tool, { defaults, user })) {
        warnings.push(looseningWarning(
          `toolAllowList.${tool}`,
          `workspace value for "toolAllowList.${tool}" was ignored because the user scope denies the tool`,
        ));
        continue;
      }

      retained[tool] = allowed;
    }

    if (Object.keys(retained).length === 0) {
      delete next.toolAllowList;
    } else {
      next.toolAllowList = retained;
    }
  }

  if (next.plugins !== undefined) {
    const retained: Record<string, PluginRolloutMode> = {};

    for (const [id, mode] of Object.entries(next.plugins)) {
      const ceiling = pluginCeiling(id, { defaults, user });

      if (PLUGIN_ROLLOUT_ORDER[mode] > PLUGIN_ROLLOUT_ORDER[ceiling]) {
        warnings.push(looseningWarning(
          `plugins.${id}`,
          `workspace value "${mode}" was ignored because the highest permitted rollout is "${ceiling}"`,
        ));
        continue;
      }

      retained[id] = mode;
    }

    if (Object.keys(retained).length === 0) {
      delete next.plugins;
    } else {
      next.plugins = retained;
    }
  }

  return { patch: next, warnings };
}

/**
 * Meet operator for the read governors: the smallest defined layer wins.
 *
 * @param defaultValue - Value used when no layer defines the governor.
 * @param candidates - Governor values supplied by each layer.
 * @returns The most restrictive value.
 */
function meetGovernor(
  defaultValue: number,
  ...candidates: readonly (number | undefined)[]
): number {
  const defined = candidates.filter(
    (candidate): candidate is number => candidate !== undefined && Number.isFinite(candidate),
  );

  return defined.length === 0 ? defaultValue : Math.min(...defined);
}

/**
 * Join operator for the retention keys: the largest layer value wins, capped
 * at the kernel ceiling. A layer value below the default would shorten
 * retention, so it is ignored and reported as a loosening.
 *
 * @param key - Retention key.
 * @param defaultValue - Base policy value (the floor).
 * @param layers - Scope and value of each layer that may raise the floor.
 * @param warnings - Sink for loosening warnings.
 * @returns The effective value.
 */
function joinRetention(
  key: RetentionKey,
  defaultValue: number,
  layers: readonly (readonly [ConfigScope, number | undefined])[],
  warnings: SettingsWarning[],
): number {
  let effective = defaultValue;

  for (const [scope, candidate] of layers) {
    if (candidate === undefined || !Number.isFinite(candidate)) {
      continue;
    }

    if (candidate < defaultValue) {
      warnings.push(looseningWarning(
        key,
        `${scope} value ${candidate} for "${key}" was ignored because history retention can only be raised (minimum ${defaultValue})`,
        scope,
      ));
      continue;
    }

    effective = Math.max(effective, Math.floor(candidate));
  }

  return Math.min(RETENTION_CEILINGS[key], effective);
}
