/**
 * Existence probe supplied by the caller.
 *
 * The utility service performs no I/O of its own: the host decides which
 * paths exist. A synchronous probe is adapted automatically.
 */
export type FileExistsProbe = (path: string) => boolean | Promise<boolean>;

/**
 * Named-argument form of {@link IUtilityService.resolveImports}.
 *
 * `filePath` is both the resolution base and the language hint: its extension
 * selects the import pattern table. `customPatterns` replaces the built-in
 * patterns; each regex source must expose the module specifier in capture
 * group 1.
 */
export interface ResolveImportsOptions {
  /** Path of the source file, used as the resolution base and language hint. */
  readonly filePath: string;

  /** Existence probe supplied by the caller; the utility never touches disk. */
  readonly fileExists: FileExistsProbe;

  /** Optional replacement regex sources; capture group 1 is the specifier. */
  readonly customPatterns?: readonly string[];

  /**
   * Optional explicit language hint (`typescript`, `python`, `go`, `rust`).
   *
   * When omitted, the file extension selects the table, preserving the existing
   * resolver's behaviour exactly. An unknown hint raises `INVALID_FIELD`.
   */
  readonly language?: string;
}

/**
 * Level-1 utility service hosting pure, stateless functions.
 *
 * Per D-20 the contract carries no permissions and no ambient authority: a
 * caller receives only the pure functions below, never a filesystem, settings,
 * terminal, history, or tool handle.
 */
export interface IUtilityService {
  /**
   * Resolves every local import in a source string to a concrete file path.
   *
   * External package specifiers are ignored. Resolved paths follow discovery
   * order and contain no duplicates. The caller supplies the file path and an
   * existence probe, so the resolver itself performs no I/O.
   *
   * @param content - Source text to scan.
   * @param options - Resolution base, existence probe, and optional patterns.
   * @returns Resolved local paths in discovery order.
   */
  resolveImports(content: string, options: ResolveImportsOptions): Promise<string[]>;

  /**
   * Positional form preserved from the earlier `resolveImports` API.
   *
   * @param content - Source text to scan.
   * @param filePath - Path of the source file.
   * @param fileExists - Existence probe supplied by the caller.
   * @param customPatterns - Optional replacement regex sources.
   */
  resolveImports(
    content: string,
    filePath: string,
    fileExists: FileExistsProbe,
    customPatterns?: readonly string[],
  ): Promise<string[]>;
}