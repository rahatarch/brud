import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createUtilityDescriptor } from './descriptor/UtilityServiceDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  void context;

  return createUtilityDescriptor();
}