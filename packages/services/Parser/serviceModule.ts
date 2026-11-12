import type { KernelServiceModuleContext } from '@brud/kernel';
import { createParserDescriptor } from './descriptor/ParserDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  void context;

  return createParserDescriptor();
}