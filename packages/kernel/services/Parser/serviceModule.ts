import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createParserDescriptor } from './descriptor/ParserDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  void context;

  return createParserDescriptor();
}