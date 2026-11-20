/**
 * Per-plugin rollout mode.
 *
 * `off` disables the plugin, `shadow` executes it without user-visible side
 * effects, and `active` allows normal execution.
 */
export type PluginRolloutMode = 'off' | 'shadow' | 'active';

/**
 * Configuration scope a settings document belongs to.
 *
 * The scope labels are the only configuration identity exposed to callers.
 * Concrete file paths are owned by the storage adapter and never travel
 * through this contract.
 */
export type ConfigScope = 'user' | 'workspace';

/**
 * Immutable policy snapshot published by the settings service.
 *
 * Instances are deep-frozen at construction. Consumers may cache the snapshot
 * for the lifetime of a declared boundary and must never observe mutation.
 */
export interface SettingsSnapshot {
  readonly schemaVersion: 1;
  readonly workspaceBoundaryEnabled: boolean;
  readonly commandValidationEnabled: boolean;
  readonly toolAllowList: Readonly<Record<string, boolean>>;
  readonly readConcurrency: number;
  readonly readMaxBatchFiles: number;
  readonly readMaxAggregateBytes: number;
  readonly plugins: Readonly<Record<string, PluginRolloutMode>>;
  /**
   * Days of history kept before retention may remove it (D-15 U-8). Layers can
   * only raise it: the effective value is the maximum across layers, capped.
   */
  readonly historyRetentionDays: number;
  /**
   * Newest file entries always kept for undo, whatever their age (D-15 U-8).
   * Layers can only raise it, like {@link historyRetentionDays}.
   */
  readonly historyMinUndoEntries: number;
}

/** Machine-readable classification of a non-fatal settings condition. */
export type SettingsWarningCode =
  | 'MALFORMED_DOCUMENT'
  | 'INVALID_FIELD'
  | 'VALUE_CLAMPED'
  | 'SAFETY_LOOSENING_IGNORED'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'INTERNAL_ERROR'
  | 'LISTENER_FAILED'
  | 'STAGING_SWEPT';

/**
 * Structured, path-free warning produced while loading or validating settings.
 *
 * Messages never contain absolute host paths so they can safely cross an RPC
 * boundary.
 */
export interface SettingsWarning {
  readonly code: SettingsWarningCode;
  readonly scope: ConfigScope | 'defaults';
  readonly field?: string;
  readonly message: string;
}

/**
 * Read-only view of the settings service.
 *
 * Userland callers and read-only plugins receive this interface. It exposes
 * the frozen snapshot and change subscription only; mutators stay on the
 * kernel/host service.
 */
export interface ISettingsReader {
  /** Returns the immutable, deep-frozen boot snapshot. */
  getSnapshot(): SettingsSnapshot;

  /**
   * Subscribes to snapshot changes published at declared boundaries.
   *
   * @param listener - Invoked with the new frozen snapshot after a publish.
   * @returns An idempotent unsubscribe function.
   */
  onChange(listener: (snapshot: SettingsSnapshot) => void): () => void;
}

/**
 * Kernel/host settings service contract.
 *
 * `reload` and `update` are intentionally absent from {@link ISettingsReader}
 * and are stripped by the descriptor projection for userland callers.
 */
export interface ISettingsService extends ISettingsReader {
  /** Atomically reloads both scopes and publishes a new frozen snapshot. */
  reload(): Promise<SettingsSnapshot>;

  /** Updates a specific scope with atomic file staging and lattice validation. */
  update(scope: ConfigScope, patch: Partial<SettingsSnapshot>): Promise<SettingsSnapshot>;
}

/**
 * Narrows an arbitrary value to a {@link ConfigScope}.
 *
 * @param value - Candidate scope label.
 * @returns `true` when the value is a supported scope.
 */
export function isConfigScope(value: unknown): value is ConfigScope {
  return value === 'user' || value === 'workspace';
}
