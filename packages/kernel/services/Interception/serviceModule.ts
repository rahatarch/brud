import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createInterceptionDescriptor } from './descriptor/InterceptionDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  void context;
  return createInterceptionDescriptor();
}
