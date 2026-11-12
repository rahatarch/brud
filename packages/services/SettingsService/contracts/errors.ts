import type { ConfigScope } from './ISettingsService.js';

/** Stable, machine-readable settings failure codes. */
export type SettingsErrorCode =
  | 'SETTINGS_PARSE_FAILED'
  | 'SETTINGS_READ_FAILED'
  | 'SETTINGS_WRITE_FAILED'
  | 'SETTINGS_LOCK_TIMEOUT'
  | 'SETTINGS_CONCURRENCY_CONFLICT'
  | 'SETTINGS_INVALID_PATH'
  | 'SETTINGS_UNKNOWN_SCOPE';

/** Context shared by every typed settings failure. */
export interface SettingsErrorContext {
  readonly scope?: ConfigScope;
  readonly syscallCode?: string;
}

/**
 * Base class for every settings domain failure.
 *
 * Messages are scrubbed to scope labels and errno codes. They never embed an
 * absolute host path, so they are safe to serialize across RPC surfaces.
 */
export abstract class SettingsError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: SettingsErrorCode;

  /** Scope the failure belongs to, when it is scope-specific. */
  public readonly scope?: ConfigScope;

  /** Underlying errno code (`EACCES`, `ENOENT`, ...) when one is known. */
  public readonly syscallCode?: string;

  /**
   * @param message - Path-free, human-readable failure description.
   * @param context - Optional scope and errno classification.
   */
  protected constructor(message: string, context?: SettingsErrorContext) {
    super(message);
    this.name = 'SettingsError';

    if (context?.scope !== undefined) {
      this.scope = context.scope;
    }

    if (context?.syscallCode !== undefined) {
      this.syscallCode = context.syscallCode;
    }
  }
}

/** Raised when a settings document is not valid JSON or not a JSON object. */
export class SettingsParseError extends SettingsError {
  public readonly code = 'SETTINGS_PARSE_FAILED' as const;

  /**
   * @param scope - Scope containing the malformed document.
   */
  constructor(scope: ConfigScope) {
    super(`Malformed settings document in "${scope}" scope`, { scope });
    this.name = 'SettingsParseError';
  }
}

/** Raised when a settings read or write fails for a non-ENOENT reason. */
export class SettingsIOError extends SettingsError {
  public readonly code: 'SETTINGS_READ_FAILED' | 'SETTINGS_WRITE_FAILED';

  /** Operation that failed. */
  public readonly operation: 'read' | 'write';

  /**
   * @param operation - Failed operation.
   * @param scope - Scope the operation targeted.
   * @param syscallCode - Optional underlying errno code.
   */
  constructor(operation: 'read' | 'write', scope: ConfigScope, syscallCode?: string) {
    super(
      `Settings ${operation} failed for "${scope}" scope${syscallCode === undefined ? '' : ` (${syscallCode})`}`,
      { scope, ...(syscallCode === undefined ? {} : { syscallCode }) },
    );
    this.name = 'SettingsIOError';
    this.operation = operation;
    this.code = operation === 'read' ? 'SETTINGS_READ_FAILED' : 'SETTINGS_WRITE_FAILED';
  }
}

/** Raised when the advisory write lock cannot be acquired before the deadline. */
export class SettingsLockTimeoutError extends SettingsError {
  public readonly code = 'SETTINGS_LOCK_TIMEOUT' as const;

  /** Deadline that was exceeded, in milliseconds. */
  public readonly timeoutMs: number;

  /**
   * @param scope - Scope whose lock timed out.
   * @param timeoutMs - Deadline that was exceeded.
   */
  constructor(scope: ConfigScope, timeoutMs: number) {
    super(`Timed out acquiring the "${scope}" settings write lock after ${timeoutMs}ms`, { scope });
    this.name = 'SettingsLockTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Raised when a target document changed on disk between the mtime the caller
 * observed and the mtime the transaction read under the write lock.
 */
export class SettingsConcurrencyError extends SettingsError {
  public readonly code = 'SETTINGS_CONCURRENCY_CONFLICT' as const;

  /** mtime the caller expected to still be current, in milliseconds. */
  public readonly expectedMtimeMs: number;

  /** mtime actually found on disk, in milliseconds. */
  public readonly actualMtimeMs: number;

  /**
   * @param scope - Scope whose document changed.
   * @param expectedMtimeMs - mtime the caller expected.
   * @param actualMtimeMs - mtime found under the lock.
   */
  constructor(scope: ConfigScope, expectedMtimeMs: number, actualMtimeMs: number) {
    super(
      `Settings "${scope}" document changed since it was read; no write was applied`,
      { scope },
    );
    this.name = 'SettingsConcurrencyError';
    this.expectedMtimeMs = expectedMtimeMs;
    this.actualMtimeMs = actualMtimeMs;
  }
}

/** Raised when a bootstrap or resolved path is not usable (absolute, contained, not dangling). */
export class SettingsPathError extends SettingsError {
  public readonly code = 'SETTINGS_INVALID_PATH' as const;

  /**
   * @param scope - Scope whose path failed validation, when known.
   */
  constructor(scope?: ConfigScope) {
    super(
      scope === undefined
        ? 'Invalid settings path configuration: paths must be absolute, contained, and free of null bytes'
        : `Invalid settings path configuration for "${scope}" scope`,
      scope === undefined ? undefined : { scope },
    );
    this.name = 'SettingsPathError';
  }
}

/** Raised when a runtime value is not a supported configuration scope. */
export class SettingsScopeError extends SettingsError {
  public readonly code = 'SETTINGS_UNKNOWN_SCOPE' as const;

  constructor() {
    super('Unknown settings scope');
    this.name = 'SettingsScopeError';
  }
}

/**
 * Extracts an errno-style code without exposing the original error object.
 *
 * @param error - Arbitrary thrown value.
 * @returns The string code when the value carries one.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) {
    return undefined;
  }

  const value: unknown = error.code;

  return typeof value === 'string' ? value : undefined;
}
