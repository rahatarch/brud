import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { ParserToken } from '../../Parser/descriptor/tokens.js';
import type { IBrudParserService } from '../../Parser/contracts/IParserService.js';
import { ROUTER_CALLER_ID } from '../contracts/caller.js';
import type { IRouterService } from '../contracts/IRouterService.js';
import { RouterService } from '../orchestrator/index.js';
import { RouterToken } from './tokens.js';
import { withExposureBindings } from '../../ExposedApiRegistry/contracts/registrant.js';
import { ExposedApiRegistryToken } from '../../ExposedApiRegistry/descriptor/tokens.js';
import type { ExposedApiCaller, IExposedApiRegistry } from '../../ExposedApiRegistry/contracts/index.js';
import { requireContextString } from '../../../src/contracts/contextContract.js';
import { ROUTER_ROOT_CONTEXT_FIELD } from '../bootOptions.js';
import type { BrudDispatchCaller, BrudKindDispatcher, BrudRouteOptions } from '../contracts/types.js';

/** The Router's v1 entry exposure. */
export const ROUTER_EXPOSURE = 'syntax.route';

/** Tier assigned to the Router descriptor. */
export const ROUTER_SERVICE_TIER: ServiceTier = 'core';

/** Contract version declared for the Router interface. */
export const ROUTER_CONTRACT_VERSION = '2.0.0';

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
    // Token access is kernel-internal. Every other caller enters through the
    // `syntax.route@1` exposure, where the caller comes from the call chain.
    accessPolicy: {
      allowedCallers: ['kernel', ROUTER_CALLER_ID],
    },
    manifest: {
      exposures: [{ name: ROUTER_EXPOSURE, version: 1, scope: 'any' }],
    },
    factory: (context, broker): RouterService => {
      const callerContext = {
        callerId: ROUTER_CALLER_ID,
        tier: 'core' as const,
        options: context.options,
      };
      let registry: IExposedApiRegistry | undefined;
      const service = new RouterService({
        resolveOwner: (exposure, version, owner) => {
          registry ??= broker.requestAccess(callerContext, ExposedApiRegistryToken);

          return registry.resolve<BrudKindDispatcher>(exposure, {
            ...(version === undefined ? {} : { version }),
            ...(owner === undefined ? {} : { expectedOwner: owner }),
          });
        },
        defaultWorkspaceRoot: () => requireContextString(
          context.options,
          ROUTER_ROOT_CONTEXT_FIELD,
          ROUTER_CALLER_ID,
        ),
        getParser: () => options?.parser
          ?? broker.requestAccess(callerContext, ParserToken),
      });

      options?.onConstruct?.(service);

      // Delegation by the owner: the real caller is captured here, at resolve
      // time, and carried to every kind owner the request reaches.
      return withExposureBindings(service, {
        [`${ROUTER_EXPOSURE}@1`]: {
          projection: (_service: unknown, caller: ExposedApiCaller) => {
            const view: BrudDispatchCaller = Object.freeze({
              identity: caller.identity,
              callerClass: caller.callerClass,
              official: caller.official,
              capabilities: Object.freeze([...caller.capabilities].sort()),
              origin: caller.origin,
            });

            return Object.freeze({
              route: (rawInput: string, routeOptions?: BrudRouteOptions) => service.route(rawInput, routeOptions, view),
              registeredKinds: () => service.registeredKinds(),
            });
          },
        },
      });
    },
  };
}

export const RouterDescriptor: ServiceDescriptor<IRouterService, RouterService> =
  createRouterDescriptor();