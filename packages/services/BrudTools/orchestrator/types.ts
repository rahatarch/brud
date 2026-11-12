import type { IPluginLogger } from '../../PluginManager/contracts/IPluginContext.js';

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
  /** Diagnostic sink for registry and dispatch warnings. */
  readonly logger?: IPluginLogger;

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