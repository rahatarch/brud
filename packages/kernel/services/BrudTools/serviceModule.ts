import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { BrudToolsDescriptorOptions } from './descriptor/BrudToolsDescriptor.js';
import { createBrudToolsDescriptor } from './descriptor/BrudToolsDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  return createBrudToolsDescriptor(
    context.options['tools'] as BrudToolsDescriptorOptions | undefined,
  );
}