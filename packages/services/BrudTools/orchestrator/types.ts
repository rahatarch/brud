/** The logging BrudTools needs; any logger with `warn` fits. */
export interface IToolsLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Injected collaborators of {@link BrudToolsService}.
 *
 * Every dependency is optional so the service can be constructed standalone
 * (tests, alternate compositions) without a logger or a settings source.
 *
 * Payload validation is not a dependency: the service compiles each tool's
 * registered `parametersSchema` through the kernel's zero-dependency JSON
 * Schema compiler, so there is no operation-kind gate to inject.
 */
export interface BrudToolsDependencies {
  /**
   * Resolves a tool owner's exposure on the current call chain (pinned to the
   * owner's kernel identity when known). Absent → exposure tools are unavailable.
   */
  readonly resolveToolExposure?: (name: string, version: number, owner: string | undefined) => unknown;

  /** Diagnostic sink for registry and dispatch warnings. */
  readonly logger?: IToolsLogger;

  /**
   * Lazily reads the current tool allow-list.
   *
   * The standard kernel supplies an accessor backed by
   * `brud.core.settings.reader`; the accessor is only touched at dispatch time,
   * so the service's declared dependency graph is unchanged. An absent
   * accessor, an unavailable settings source, or an empty map all mean "allow",
   * matching the default. Only an explicit `false` disables a tool.
   */
  readonly getToolAllowList?: () => Readonly<Record<string, boolean>>;
}