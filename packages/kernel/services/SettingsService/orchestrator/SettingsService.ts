import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type { IConfigStore } from '../contracts/IConfigStore.js';
import {
  isConfigScope,
  type ConfigScope,
  type ISettingsReader,
  type ISettingsService,
  type PluginRolloutMode,
  type SettingsSnapshot,
  type SettingsWarning,
} from '../contracts/ISettingsService.js';
import {
  SettingsConcurrencyError,
  SettingsIOError,
  SettingsParseError,
  SettingsPathError,
  SettingsScopeError,
  getErrorCode,
} from '../contracts/errors.js';
import {
  DEFAULT_SETTINGS,
  PLUGIN_ROLLOUT_MODES,
  SETTINGS_SCHEMA_VERSION,
  createSettingsSnapshot,
  sanitizeSettingsDocument,
  type SanitizedSettingsDocument,
} from '../model/defaults.js';
import {
  SAFETY_KEYS,
  applyLatticeToWorkspacePatch,
  evaluateLattice,
  type MutableSettingsPatch,
} from '../model/lattice.js';

const SCOPES: readonly ConfigScope[] = ['user', 'workspace'];

/** Construction options for {@link SettingsService}. */
export interface SettingsServiceOptions {
  /** Scope-gated storage port. */
  readonly store: IConfigStore;

  /** Base policy. Defaults to {@link DEFAULT_SETTINGS}. */
  readonly defaults?: SettingsSnapshot;

  /** Optional sink for structured warnings. Warnings are also retained. */
  readonly onWarning?: (warning: SettingsWarning) => void;
}

type ChangeListener = (snapshot: SettingsSnapshot) => void;

/** Safety invariants captured once at boot and never relaxed mid-session. */
interface BootSafetyPolicy {
  readonly workspaceBoundaryEnabled: boolean;
  readonly commandValidationEnabled: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeDocument(raw: string, scope: ConfigScope): SanitizedSettingsDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SettingsParseError(scope);
  }

  return sanitizeSettingsDocument(parsed, scope);
}

function readBooleanMap(value: unknown): Record<string, boolean> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const result: Record<string, boolean> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'boolean') {
      result[key] = entry;
    }
  }

  return result;
}

function readPluginMap(value: unknown): Record<string, PluginRolloutMode> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const result: Record<string, PluginRolloutMode> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && PLUGIN_ROLLOUT_MODES.includes(entry as PluginRolloutMode)) {
      result[key] = entry as PluginRolloutMode;
    }
  }

  return result;
}

function mergePatch(
  existing: Record<string, unknown>,
  patch: MutableSettingsPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };

  if (patch.workspaceBoundaryEnabled !== undefined) {
    next.workspaceBoundaryEnabled = patch.workspaceBoundaryEnabled;
  }

  if (patch.commandValidationEnabled !== undefined) {
    next.commandValidationEnabled = patch.commandValidationEnabled;
  }

  if (patch.toolAllowList !== undefined) {
    next.toolAllowList = { ...readBooleanMap(existing.toolAllowList), ...patch.toolAllowList };
  }

  if (patch.readConcurrency !== undefined) {
    next.readConcurrency = patch.readConcurrency;
  }

  if (patch.readMaxBatchFiles !== undefined) {
    next.readMaxBatchFiles = patch.readMaxBatchFiles;
  }

  if (patch.readMaxAggregateBytes !== undefined) {
    next.readMaxAggregateBytes = patch.readMaxAggregateBytes;
  }

  if (patch.plugins !== undefined) {
    next.plugins = { ...readPluginMap(existing.plugins), ...patch.plugins };
  }

  if (patch.historyRetentionDays !== undefined) {
    next.historyRetentionDays = patch.historyRetentionDays;
  }

  if (patch.historyMinUndoEntries !== undefined) {
    next.historyMinUndoEntries = patch.historyMinUndoEntries;
  }

  if (next.schemaVersion === undefined) {
    next.schemaVersion = SETTINGS_SCHEMA_VERSION;
  }

  return next;
}

function asSettingsIOError(
  operation: 'read' | 'write',
  scope: ConfigScope,
  error: unknown,
): SettingsIOError {
  if (error instanceof SettingsIOError) {
    return error;
  }

  return new SettingsIOError(operation, scope, getErrorCode(error));
}

/**
 * Read-only facade handed to userland callers and read-only plugins.
 *
 * Only the two reader methods are copied, so mutators cannot be reached
 * through the returned object.
 *
 * @param reader - Reader or service to project.
 * @returns A frozen, mutation-free reader.
 */
export function createSettingsReader(reader: ISettingsReader): ISettingsReader {
  return Object.freeze({
    getSnapshot: (): SettingsSnapshot => reader.getSnapshot(),
    onChange: (listener: ChangeListener): (() => void) => reader.onChange(listener),
  });
}

/**
 * Settings orchestrator for `brud.core.settings`.
 *
 * `initialize()` is deliberately non-fatal: missing files, malformed JSON,
 * and permission faults fall back to defaults or the last-good snapshot with a
 * structured warning. A settings fault never aborts kernel boot.
 */
export class SettingsService implements ISettingsService, IServiceLifecycle {
  private readonly store: IConfigStore;

  private readonly defaults: SettingsSnapshot;

  private readonly onWarning: ((warning: SettingsWarning) => void) | undefined;

  private readonly listeners = new Set<ChangeListener>();

  private readonly rawCache: Record<ConfigScope, string | null> = {
    user: null,
    workspace: null,
  };

  private snapshot: SettingsSnapshot;

  private warnings: SettingsWarning[] = [];

  /**
   * Safety policy pinned at boot. `reload()` may tighten these values but never
   * relax them for the lifetime of the process.
   */
  private bootSafetyPolicy!: BootSafetyPolicy;

  constructor(options: SettingsServiceOptions) {
    this.store = options.store;
    this.defaults = options.defaults === undefined
      ? DEFAULT_SETTINGS
      : createSettingsSnapshot(options.defaults);
    this.onWarning = options.onWarning;
    this.snapshot = createSettingsSnapshot(this.defaults);
    this.bootSafetyPolicy = Object.freeze({
      workspaceBoundaryEnabled: this.snapshot.workspaceBoundaryEnabled,
      commandValidationEnabled: this.snapshot.commandValidationEnabled,
    });
  }

  /**
   * Loads both scopes and publishes the boot snapshot.
   *
   * Never throws. Any unreadable, malformed, or invalid document degrades to
   * defaults (or the last-good raw document) and is reported through
   * {@link getWarnings}.
   */
  public async initialize(): Promise<void> {
    try {
      this.warnings = [];
      this.rawCache.user = null;
      this.rawCache.workspace = null;

      await this.sweepOrphanedTemps();

      for (const scope of SCOPES) {
        await this.captureScope(scope, 'boot');
      }

      const bootSnapshot = this.buildSnapshot();
      this.bootSafetyPolicy = Object.freeze({
        workspaceBoundaryEnabled: bootSnapshot.workspaceBoundaryEnabled,
        commandValidationEnabled: bootSnapshot.commandValidationEnabled,
      });

      this.publish(bootSnapshot);
    } catch {
      this.recordWarning({
        code: 'INTERNAL_ERROR',
        scope: 'defaults',
        message: 'Settings initialization failed; the kernel booted with default settings.',
      });
      this.snapshot = createSettingsSnapshot(this.defaults);
    }
  }

  /** Releases change listeners. */
  public dispose(): void {
    this.listeners.clear();
    this.warnings = [];
  }

  public getSnapshot(): SettingsSnapshot {
    return this.snapshot;
  }

  public onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reloads both scopes and publishes a new frozen snapshot.
   *
   * A read fault in either scope retains the previous snapshot. A malformed
   * document is ignored for that scope (defaults apply) and reported, but the
   * file is left untouched.
   */
  public async reload(): Promise<SettingsSnapshot> {
    this.warnings = [];

    try {
      let complete = true;

      for (const scope of SCOPES) {
        const loaded = await this.captureScope(scope, 'reload');

        if (!loaded) {
          complete = false;
        }
      }

      if (!complete) {
        return this.snapshot;
      }

      return this.publish(this.enforceBootSafetyPolicy(this.buildSnapshot()));
    } catch {
      this.recordWarning({
        code: 'INTERNAL_ERROR',
        scope: 'defaults',
        message: 'Settings reload failed; the previous snapshot was retained.',
      });

      return this.snapshot;
    }
  }

  /**
   * Writes a patch to one scope and publishes the resulting snapshot.
   *
   * Workspace patches are filtered through the monotonic safety lattice before
   * they reach disk. Existing malformed documents are never overwritten: the
   * update fails with {@link SettingsParseError} and the file is preserved.
   *
   * @param scope - Scope to update.
   * @param patch - Partial snapshot fields to merge.
   * @returns The newly published snapshot.
   */
  public async update(
    scope: ConfigScope,
    patch: Partial<SettingsSnapshot>,
  ): Promise<SettingsSnapshot> {
    if (!isConfigScope(scope)) {
      throw new SettingsScopeError();
    }

    this.warnings = [];

    let writtenContent: string;

    try {
      const result = await this.store.transact(scope, async (currentContent) => {
        const existingDocument = this.parseForUpdate(scope, currentContent);
        const sanitized = sanitizeSettingsDocument(patch, scope);
        this.pushWarnings(sanitized.warnings);

        let filtered: MutableSettingsPatch = { ...sanitized.values };

        if (scope === 'workspace') {
          const userValues = await this.loadUserLayer();
          const lattice = applyLatticeToWorkspacePatch(sanitized.values, {
            user: userValues,
            defaults: this.defaults,
          });

          filtered = lattice.patch;
          this.pushWarnings(lattice.warnings);
        }

        const nextDocument = mergePatch(existingDocument, filtered);

        return `${JSON.stringify(nextDocument, null, 2)}\n`;
      });

      writtenContent = result.writtenContent;
    } catch (error: unknown) {
      if (
        error instanceof SettingsParseError
        || error instanceof SettingsScopeError
        || error instanceof SettingsPathError
        || error instanceof SettingsConcurrencyError
      ) {
        throw error;
      }

      this.recordWarning({
        code: 'WRITE_FAILED',
        scope,
        message: `Unable to write "${scope}" settings; the previous document was retained.`,
      });

      throw asSettingsIOError('write', scope, error);
    }

    this.rawCache[scope] = writtenContent;

    const otherScope: ConfigScope = scope === 'user' ? 'workspace' : 'user';
    await this.captureScope(otherScope, 'update');

    return this.publish(this.buildSnapshot());
  }

  /**
   * Returns the structured warnings from the most recent load, reload, or
   * update. Messages never contain absolute host paths.
   */
  public getWarnings(): readonly SettingsWarning[] {
    return Object.freeze(this.warnings.map((warning) => Object.freeze({ ...warning })));
  }

  private async captureScope(
    scope: ConfigScope,
    mode: 'boot' | 'reload' | 'update',
  ): Promise<boolean> {
    try {
      this.rawCache[scope] = (await this.store.readSnapshot(scope)).content;
      return true;
    } catch (error: unknown) {
      const code = error instanceof SettingsIOError ? error.syscallCode : getErrorCode(error);
      const consequence = mode === 'boot'
        ? 'Default settings are in effect for this scope.'
        : 'The previous snapshot was retained for this scope.';

      this.recordWarning({
        code: 'READ_FAILED',
        scope,
        message: `Unable to read "${scope}" settings${code === undefined ? '' : ` (${code})`}. ${consequence}`,
      });

      return false;
    }
  }

  private decodeForLoad(scope: ConfigScope): SanitizedSettingsDocument {
    const raw = this.rawCache[scope];

    if (raw === null) {
      return { values: {}, warnings: [] };
    }

    try {
      return decodeDocument(raw, scope);
    } catch (error: unknown) {
      if (!(error instanceof SettingsParseError)) {
        throw error;
      }

      this.recordWarning({
        code: 'MALFORMED_DOCUMENT',
        scope,
        message: `Malformed JSON in "${scope}" settings; this scope is ignored and the file is left untouched.`,
      });

      return { values: {}, warnings: [] };
    }
  }

  private buildSnapshot(): SettingsSnapshot {
    const user = this.decodeForLoad('user');
    const workspace = this.decodeForLoad('workspace');

    this.pushWarnings(user.warnings);
    this.pushWarnings(workspace.warnings);

    const lattice = evaluateLattice({
      user: user.values,
      workspace: workspace.values,
      defaults: this.defaults,
    });

    this.pushWarnings(lattice.warnings);

    return lattice.snapshot;
  }

  private parseForUpdate(
    scope: ConfigScope,
    raw: string | null,
  ): Record<string, unknown> {
    if (raw === null) {
      return {};
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }

    if (!isPlainRecord(parsed)) {
      this.recordWarning({
        code: 'MALFORMED_DOCUMENT',
        scope,
        message: `Refusing to overwrite malformed "${scope}" settings; fix or remove the file and retry.`,
      });

      throw new SettingsParseError(scope);
    }

    return parsed;
  }

  private async loadUserLayer(): Promise<Partial<SettingsSnapshot>> {
    await this.captureScope('user', 'update');

    return this.decodeForLoad('user').values;
  }

  private async sweepOrphanedTemps(): Promise<void> {
    try {
      const removed = await this.store.sweepOrphanedTemps();

      if (removed > 0) {
        this.recordWarning({
          code: 'STAGING_SWEPT',
          scope: 'defaults',
          field: 'stagingFiles',
          message: `Removed ${removed} orphaned settings staging file(s) left by a terminated process.`,
        });
      }
    } catch {
      // Sweeping is best-effort housekeeping and must never block boot.
    }
  }

  /**
   * Re-applies the boot-pinned safety policy to a freshly loaded snapshot.
   *
   * A document that flipped a boot-enabled safety policy to `false` is refused:
   * the pinned value is preserved and the attempt is reported with
   * `MID_SESSION_SAFETY_LOOSENING_REJECTED:<key>`.
   *
   * @param candidate - Snapshot resolved from disk.
   * @returns The candidate, or a pinned replacement when loosening was found.
   */
  private enforceBootSafetyPolicy(candidate: SettingsSnapshot): SettingsSnapshot {
    const values = {
      workspaceBoundaryEnabled: candidate.workspaceBoundaryEnabled,
      commandValidationEnabled: candidate.commandValidationEnabled,
      toolAllowList: candidate.toolAllowList,
      readConcurrency: candidate.readConcurrency,
      readMaxBatchFiles: candidate.readMaxBatchFiles,
      readMaxAggregateBytes: candidate.readMaxAggregateBytes,
      plugins: candidate.plugins,
      historyRetentionDays: candidate.historyRetentionDays,
      historyMinUndoEntries: candidate.historyMinUndoEntries,
    };
    let loosened = false;

    for (const key of SAFETY_KEYS) {
      if (this.bootSafetyPolicy[key] === true && values[key] === false) {
        values[key] = true;
        loosened = true;
        this.recordWarning({
          code: 'SAFETY_LOOSENING_IGNORED',
          scope: 'defaults',
          field: key,
          message: `MID_SESSION_SAFETY_LOOSENING_REJECTED:${key} - "${key}" was enabled at boot and cannot be disabled mid-session.`,
        });
      }
    }

    return loosened ? createSettingsSnapshot(values) : candidate;
  }

  private publish(snapshot: SettingsSnapshot): SettingsSnapshot {
    this.snapshot = snapshot;

    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        this.recordWarning({
          code: 'LISTENER_FAILED',
          scope: 'defaults',
          message: 'A settings change listener threw; the new snapshot was still published.',
        });
      }
    }

    return snapshot;
  }

  private pushWarnings(warnings: readonly SettingsWarning[]): void {
    for (const warning of warnings) {
      this.recordWarning(warning);
    }
  }

  private recordWarning(warning: SettingsWarning): void {
    const duplicate = this.warnings.some(
      (existing) => existing.code === warning.code
        && existing.scope === warning.scope
        && existing.field === warning.field
        && existing.message === warning.message,
    );

    if (duplicate) {
      return;
    }

    const frozen = Object.freeze({ ...warning });
    this.warnings.push(frozen);

    try {
      this.onWarning?.(frozen);
    } catch {
      // A diagnostic sink must never affect settings semantics.
    }
  }
}
