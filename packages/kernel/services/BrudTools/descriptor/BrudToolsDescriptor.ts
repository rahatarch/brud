import type { ServiceContext, ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IPluginLogger } from '../../PluginManager/contracts/IPluginContext.js';
import type { IValidationService } from '../../ValidationService/contracts/IValidationService.js';
import { ValidationToken } from '../../ValidationService/descriptor/tokens.js';
import type { IBrudToolsService } from '../contracts/IBrudToolsService.js';
import {
  BrudToolsService,
  type BrudToolsDependencies,
  type ToolSchemaDecision,
} from '../orchestrator/index.js';
import { BrudToolsToken } from './tokens.js';

/** Tier assigned to the BrudTools descriptor. */
export const BRUD_TOOLS_SERVICE_TIER: ServiceTier = 'core';

/** Configuration for {@link createBrudToolsDescriptor}. */
export interface BrudToolsDescriptorOptions {
  /**
   * Validation authority override. Defaults to `brud.core.validation` resolved
   * lazily through the access broker on first dispatch.
   */
  readonly validator?: IValidationService;

  /** Diagnostic sink override. Defaults to the boot context logger. */
  readonly logger?: IPluginLogger;
}

/**
 * Failure code the closed schema matrix reports for a kind it does not know.
 *
 * The matrix is a closed 21-kind vocabulary; a registered tool name outside it
 * is not a payload error, it is simply outside the matrix's reach.
 */
const UNKNOWN_OPERATION_CODE = 'UNKNOWN_OPERATION';

/**
 * Admits tool names the frozen operation matrix does not know.
 *
 * The gate is keyed by operation kind and tool names share that vocabulary for
 * the 21 frozen operations, so the key is enforced unchanged for those. A name
 * the matrix does not know cannot be constrained by it; admission is therefore
 * open and the tool's own handler owns its contract. Every other failure is
 * preserved unchanged, so the frozen field pass still rejects bad payloads for
 * recognized kinds.
 *
 * @param schema - Registered tool name, used as the constraint key.
 * @param input - Raw payload.
 * @param validator - Validation authority to delegate to.
 * @returns The validator decision, or success for an unrecognized operation.
 */
function admitOpenToolName(
  schema: string,
  input: unknown,
  validator: IValidationService,
): ToolSchemaDecision {
  const decision = validator.validateInput(schema, input);

  if (!decision.ok && decision.code === UNKNOWN_OPERATION_CODE) {
    return { ok: true };
  }

  return decision;
}

/**
 * Builds the BrudTools service descriptor.
 *
 * Boot position is after terminal and before the plugin manager (rollout plan
 * §2.3.4): the routing table must exist before any plugin activates, so a
 * plugin's tools become routable the moment its `activate()` returns.
 *
 * @param options - Optional validator and logger overrides.
 * @returns A core-tier descriptor for `brud.core.tools`.
 */
export function createBrudToolsDescriptor(
  options?: BrudToolsDescriptorOptions,
): ServiceDescriptor<IBrudToolsService, BrudToolsService> {
  return {
    token: BrudToolsToken,
    tier: BRUD_TOOLS_SERVICE_TIER,
    dependencies: [ValidationToken],
    accessPolicy: { deniedCallers: [] },
    factory: (context: ServiceContext, broker): BrudToolsService => {
      const kernelCaller: ServiceContext = {
        callerId: 'kernel',
        tier: 'kernel',
        workspaceRoot: context.workspaceRoot,
      };
      // The access broker only serves requests while the kernel is RUNNING and
      // service factories run during BOOTING, so the validation authority is
      // resolved on first use. Boot never touches it: the registry is usable
      // the moment the factory returns.
      let validator: IValidationService | undefined = options?.validator;

      const resolveValidator = (): IValidationService =>
        (validator ??= broker.requestAccess(kernelCaller, ValidationToken));
      const dependencies: BrudToolsDependencies = {
        // The frozen gate is keyed by operation kind, and tool names are that
        // same vocabulary (`read_file`, `create_file`, …), so the key the
        // service supplies is enforced unchanged. A name the matrix does not
        // know cannot be constrained by it; that tool's handler owns its
        // contract. The declared JSON Schema stays on the registry entry.
        validateInput: (schema: string, input: unknown) =>
          admitOpenToolName(schema, input, resolveValidator()),
        ...(options?.logger === undefined ? {} : { logger: options.logger }),
      };

      return new BrudToolsService(dependencies);
    },
  };
}
