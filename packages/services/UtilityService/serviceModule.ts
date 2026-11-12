import type { KernelServiceModuleContext } from '@brud/kernel';
import { createUtilityDescriptor } from './descriptor/UtilityServiceDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  void context;

  return createUtilityDescriptor();
}