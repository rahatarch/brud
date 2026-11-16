import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createEventsDescriptor } from './descriptor/EventsDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  void context;
  return createEventsDescriptor();
}