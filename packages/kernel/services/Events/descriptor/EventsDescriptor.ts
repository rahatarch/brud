import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IEventsService } from '../contracts/IEventsService.js';
import { EventsService } from '../orchestrator/index.js';
import { EventsToken } from './tokens.js';

export const EVENTS_SERVICE_TIER: ServiceTier = 'core';
export const EVENTS_CONTRACT_VERSION = '1.0.0';
export const EVENTS_CONTRACT_METHODS = ['emit', 'pull', 'close', 'list'] as const;

export function createEventsDescriptor(): ServiceDescriptor<IEventsService, EventsService> {
  return {
    token: EventsToken,
    tier: EVENTS_SERVICE_TIER,
    dependencies: [],
    contract: {
      version: EVENTS_CONTRACT_VERSION,
      methods: EVENTS_CONTRACT_METHODS,
    },
    accessPolicy: {
      allowedCallers: ['kernel', 'brud.core.router', 'brud.host.daemon'],
    },
    factory: (): EventsService => new EventsService(),
  };
}

export const EventsDescriptor: ServiceDescriptor<IEventsService, EventsService> =
  createEventsDescriptor();