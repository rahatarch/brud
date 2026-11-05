import type { IPluginLogger } from '../../PluginManager/contracts/IPluginContext.js';

/**
 * Injected collaborators of {@link BrudToolsService}.
 *
 * Every dependency is optional so the service can be constructed standalone
 * (tests, alternate compositions) without a logger.
 *
 * Payload validation is not a dependency: the service compiles each tool's
 * registered `parametersSchema` through the kernel's zero-dependency JSON
 * Schema compiler, so there is no legacy operation-kind gate to inject.
 */
export interface BrudToolsDependencies {
  /** Diagnostic sink for registry and dispatch warnings. */
  readonly logger?: IPluginLogger;
}