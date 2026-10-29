import type { IPluginLogger } from '../../PluginManager/contracts/IPluginContext.js';

/** Non-throwing outcome of one schema check. */
export interface ToolSchemaDecision {
  /** Whether the payload satisfies the schema. */
  readonly ok: boolean;

  /** Stable validator code, present on failures. */
  readonly code?: string;

  /** Human-readable reason, present on failures. */
  readonly friendly?: string;
}

/**
 * Injected collaborators of {@link BrudToolsService}.
 *
 * Every dependency is optional so the service can be constructed standalone
 * (tests, alternate compositions) without a broker or a logger.
 */
export interface BrudToolsDependencies {
  /**
   * Schema gate applied before a handler runs.
   *
   * Receives a constraint key and the raw payload in that order. The service
   * supplies the registered tool name, which is the same vocabulary the
   * frozen 21-kind matrix uses (`read_file`, `create_file`, …), so the kernel
   * composition wires `ValidationService.validateInput` straight through.
   * A key the gate does not know is admitted by that gate and the tool's own
   * handler owns its contract. The gate never throws for a bad payload.
   */
  readonly validateInput?: (schema: string, input: unknown) => ToolSchemaDecision;

  /** Diagnostic sink for registry and dispatch warnings. */
  readonly logger?: IPluginLogger;
}
