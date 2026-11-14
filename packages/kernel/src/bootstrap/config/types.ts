/** One service declaration. */
export interface BrudConfigEntry {
  /** Module path, package name, `kernel:` module, or relative path. */
  readonly path: string;

  /**
   * The composition owner's official declaration for this participant.
   *
   * At boot the kernel builds its identity-to-official mapping from this
   * declaration: the participant's kernel identity maps to `true` when the
   * owner declares it official, and to `false` otherwise. The mapping is a
   * Layer 1 policy input. Hardcore trust is not the owner's to change: a
   * hardcore entry that declares `official: false` fails boot.
   */
  readonly official?: boolean;
}

/**
 * Declarative kernel composition.
 *
 * The kernel owns the `services` and `exposureOwners` sections. Other
 * top-level sections belong to the participants that own them and are carried
 * by the document unchanged.
 */
export interface BrudConfig {
  readonly services: readonly BrudConfigEntry[];

  /**
   * Exposure names pinned to an owner identity.
   *
   * Maps an exposure name to the kernel identity token that alone may register
   * it in this composition.
   */
  readonly exposureOwners?: Readonly<Record<string, string>>;
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