import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createActionManagerDescriptor } from './descriptor/index.js';

export function createService(context: KernelServiceModuleContext) {
  void context;

  return createActionManagerDescriptor();
}