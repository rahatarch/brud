import type { ServiceTier } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { withExposureBindings } from '../../ExposedApiRegistry/contracts/registrant.js';
import type { ExposedApiBinding } from '../../ExposedApiRegistry/contracts/types.js';
import type { IEventsService } from '../contracts/IEventsService.js';
import { EventsService } from '../orchestrator/index.js';
import { EventsToken } from './tokens.js';

export const EVENTS_SERVICE_TIER: ServiceTier = 'core';
export const EVENTS_CONTRACT_VERSION = '1.0.0';
export const EVENTS_CONTRACT_METHODS = ['emit', 'pull', 'close', 'list'] as const;

/**
 * Per-exposure projection bindings.
 *
 * Each mechanism exposure resolves to a narrowed object exposing only its own
 * method, so a caller that resolves `events.emit` cannot reach `pull`, `close`,
 * `list`, or `bindAuthority`. The delivery methods are the instance's stubs;
 * the projections only narrow what a caller can see.
 */
function eventsExposureBindings(instance: EventsService): Record<string, ExposedApiBinding> {
  // withExposureBindings looks up a binding by `name@major`
  // (registrant.ts:exposureBindingKey), so each key carries its major version.
  return {
    'events.emit@1': { projection: () => ({ emit: (name: string, payload: unknown): void => instance.emit(name, payload) }) },
    'events.pull@1': { projection: () => ({ pull: (subscriptionId: string): readonly unknown[] => instance.pull(subscriptionId) }) },
    'events.close@1': { projection: () => ({ close: (subscriptionId: string): void => instance.close(subscriptionId) }) },
    'events.list@1': { projection: () => ({ list: (): readonly string[] => instance.list() }) },
  };
}

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
    manifest: {
      exposures: [
        { name: 'events.emit', version: 1, scope: 'runtime' },
        { name: 'events.pull', version: 1, scope: 'runtime' },
        { name: 'events.close', version: 1, scope: 'runtime' },
        { name: 'events.list', version: 1, scope: 'runtime' },
      ],
    },
    factory: (): EventsService => {
      const instance = new EventsService();

      return withExposureBindings(instance, eventsExposureBindings(instance));
    },
  };
}

export const EventsDescriptor: ServiceDescriptor<IEventsService, EventsService> =
  createEventsDescriptor();