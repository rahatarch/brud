import type { KernelServiceModuleContext } from '@brud/kernel';
import { createActionManagerDescriptor } from './descriptor/index.js';

export function createService(context: KernelServiceModuleContext) {
  void context;

  return createActionManagerDescriptor();
}