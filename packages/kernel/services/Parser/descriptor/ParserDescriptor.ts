import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IBrudParserService } from '../contracts/IParserService.js';
import { ParserService } from '../orchestrator/index.js';
import { ParserToken } from './tokens.js';
import { withExposureBindings } from '../../ExposedApiRegistry/contracts/registrant.js';

/** The Parser's v1 entry exposure. */
export const PARSER_EXPOSURE = 'syntax.parse';

/** Tier assigned to the Parser descriptor. */
export const PARSER_SERVICE_TIER: ServiceTier = 'core';

/** Contract version declared for the Parser interface. */
export const PARSER_CONTRACT_VERSION = '1.0.0';

/** Methods declared for the Parser interface. */
export const PARSER_CONTRACT_METHODS = ['parse'] as const;

/**
 * Builds the `brud.core.parser` service descriptor.
 *
 * It declares no dependencies: it is a pure syntax engine. It sits before the
 * routing service and every routing consumer in the standard boot order.
 *
 * @returns A core-tier descriptor for `brud.core.parser`.
 */
export function createParserDescriptor(): ServiceDescriptor<IBrudParserService, ParserService> {
  return {
    token: ParserToken,
    tier: PARSER_SERVICE_TIER,
    dependencies: [],
    contract: {
      version: PARSER_CONTRACT_VERSION,
      methods: PARSER_CONTRACT_METHODS,
    },
    // Token access is kernel-internal (the Router). Every other caller uses the
    // `syntax.parse@1` exposure; parsing is pure, so it carries no policy.
    accessPolicy: {
      allowedCallers: ['kernel', 'brud.core.router'],
    },
    manifest: {
      exposures: [{ name: PARSER_EXPOSURE, version: 1, scope: 'any' }],
    },
    factory: (): ParserService => {
      const service = new ParserService();

      return withExposureBindings(service, {
        [`${PARSER_EXPOSURE}@1`]: {
          projection: () => Object.freeze({
            parse: (rawInput: string, options?: Parameters<ParserService['parse']>[1]) => service.parse(rawInput, options),
          }),
        },
      });
    },
  };
}

/** Standard parser descriptor with no overrides. */
export const ParserDescriptor: ServiceDescriptor<IBrudParserService, ParserService> =
  createParserDescriptor();