import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { withExposureBindings } from '../../ExposedApiRegistry/contracts/registrant.js';
import type { ExposedApiBinding } from '../../ExposedApiRegistry/contracts/types.js';
import type {
  IInterceptionService,
  InterceptionEvaluateOptions,
  InterceptionOutcome,
  InterceptionResultOutcome,
} from '../contracts/IInterceptionService.js';
import { InterceptionService } from '../orchestrator/index.js';
import { InterceptionToken } from './tokens.js';

export const INTERCEPTION_SERVICE_TIER: ServiceTier = 'core';
export const INTERCEPTION_CONTRACT_VERSION = '1.0.0';
export const INTERCEPTION_CONTRACT_METHODS = ['evaluate', 'evaluateResult', 'list'] as const;

/**
 * Per-exposure projection bindings. Each projection captures the resolver's
 * caller view at resolve time (the registry runs projection calls as the
 * owner), so `evaluate` knows which giver is asking.
 */
function interceptionExposureBindings(instance: InterceptionService): Record<string, ExposedApiBinding> {
  return {
    'interception.evaluate@1': {
      projection: (_service, caller) => ({
        evaluate: (
          target: string,
          method: string,
          args: readonly unknown[],
          options?: InterceptionEvaluateOptions,
        ): InterceptionOutcome => instance.evaluateAs(caller, target, method, args, options),
        evaluateResult: (
          target: string,
          method: string,
          args: readonly unknown[],
          result: unknown,
          options?: InterceptionEvaluateOptions,
        ): InterceptionResultOutcome => instance.evaluateResultAs(caller, target, method, args, result, options),
      }),
    },
    'interception.list@1': { projection: () => ({ list: (): readonly string[] => instance.list() }) },
  };
}

export function createInterceptionDescriptor(): ServiceDescriptor<IInterceptionService, InterceptionService> {
  return {
    token: InterceptionToken,
    tier: INTERCEPTION_SERVICE_TIER,
    dependencies: [],
    contract: {
      version: INTERCEPTION_CONTRACT_VERSION,
      methods: INTERCEPTION_CONTRACT_METHODS,
    },
    accessPolicy: {
      allowedCallers: ['kernel'],
    },
    manifest: {
      exposures: [
        // `any`: a giver's exposure may be called from any origin, and its
        // binding evaluates in that caller's chain. `evaluate` itself admits
        // only the point's owner.
        { name: 'interception.evaluate', version: 1, scope: 'any' },
        { name: 'interception.list', version: 1, scope: 'runtime' },
      ],
    },
    factory: (): InterceptionService => {
      const instance = new InterceptionService();

      return withExposureBindings(instance, interceptionExposureBindings(instance));
    },
  };
}

export const InterceptionDescriptor: ServiceDescriptor<IInterceptionService, InterceptionService> =
  createInterceptionDescriptor();
