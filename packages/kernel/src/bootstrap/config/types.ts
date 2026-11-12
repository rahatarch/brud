/** One service or plugin declaration. */
export interface BrudConfigEntry {
  /** Module path, package name, `kernel:` module, or relative path. */
  readonly path: string;

  /** Marks the entry as first-party for the future Brand Registry. */
  readonly official?: boolean;
}

/** Declarative kernel composition. */
export interface BrudConfig {
  readonly services: readonly BrudConfigEntry[];
  readonly plugins: readonly BrudConfigEntry[];
}

/** Stable config failure codes. */
export type BrudConfigErrorCode =
  | 'CONFIG_READ'
  | 'CONFIG_PARSE'
  | 'CONFIG_SCHEMA'
  | 'CONFIG_INTEGRITY'
  | 'MODULE_RESOLVE'
  | 'MODULE_CONTRACT'
  | 'HARDCORE_VERIFICATION';

/** Config or module-resolution failure with optional source line. */
export class BrudConfigError extends Error {
  public readonly code: BrudConfigErrorCode;

  public readonly configPath: string;

  public readonly line?: number;

  constructor(
    code: BrudConfigErrorCode,
    message: string,
    configPath: string,
    line?: number,
  ) {
    super(line === undefined ? message : `${message} (line ${String(line)})`);
    this.name = 'BrudConfigError';
    this.code = code;
    this.configPath = configPath;

    if (line !== undefined) {
      this.line = line;
    }
  }
}