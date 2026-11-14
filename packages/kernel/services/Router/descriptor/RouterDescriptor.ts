import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { ParserToken } from '../../Parser/descriptor/tokens.js';
import type { IBrudParserService } from '../../Parser/contracts/IParserService.js';
import { ROUTER_CALLER_ID } from '../contracts/caller.js';
import type { IRouterService } from '../contracts/IRouterService.js';
import { RouterService } from '../orchestrator/index.js';
import { RouterToken } from './tokens.js';

/** Tier assigned to the Router descriptor. */
export const ROUTER_SERVICE_TIER: ServiceTier = 'core';

/** Contract version declared for the Router interface. */
export const ROUTER_CONTRACT_VERSION = '1.0.0';

/** Methods declared for the Router interface. */
export const ROUTER_CONTRACT_METHODS = [
  'register',
  'closeRegistration',
  'isRegistrationOpen',
  'registeredKinds',
  'route',
  'dispatch',
] as const;

/** Configuration for {@link createRouterDescriptor}. */
export interface RouterDescriptorOptions {
  /** Parser override for standalone construction and tests. */
  readonly parser?: IBrudParserService;

  /** Observation hook used by the standard composition to capture the instance. */
  readonly onConstruct?: (service: RouterService) => void;
}

/**
 * Builds the `brud.core.router` service descriptor.
 *
 * It declares the syntax service token as an ordering dependency. The syntax
 * service is resolved lazily through the broker on the first `route` call,
 * because the broker serves requests only once the kernel is RUNNING.
 *
 * @param options - Parser override and construction hook.
 * @returns A core-tier descriptor for `brud.core.router`.
 */
export function createRouterDescriptor(
  options?: RouterDescriptorOptions,
): ServiceDescriptor<IRouterService, RouterService> {
  return {
    token: RouterToken,
    tier: ROUTER_SERVICE_TIER,
    dependencies: [ParserToken],
    contract: {
      version: ROUTER_CONTRACT_VERSION,
      methods: ROUTER_CONTRACT_METHODS,
    },
    accessPolicy: {
      allowedCallers: ['kernel', ROUTER_CALLER_ID, 'brud.host.daemon'],
    },
    factory: (context, broker): RouterService => {
      const callerContext = {
        callerId: ROUTER_CALLER_ID,
        tier: 'core' as const,
        options: context.options,
      };

      const service = new RouterService({
        broker,
        callerContext,
        getParser: () => options?.parser
          ?? broker.requestAccess(callerContext, ParserToken),
      });

      options?.onConstruct?.(service);

      return service;
    },
  };
}

/** Standard router descriptor with no overrides. */
export const RouterDescriptor: ServiceDescriptor<IRouterService, RouterService> =
  createRouterDescriptor();