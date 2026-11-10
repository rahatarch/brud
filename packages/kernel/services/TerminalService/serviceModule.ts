import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { TerminalDescriptorOptions } from './descriptor/TerminalDescriptor.js';
import {
  createTerminalDescriptor,
  pinTerminalPolicies as pinTerminalPoliciesForInstances,
} from './descriptor/TerminalDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  return createTerminalDescriptor(
    context.options['terminal'] as TerminalDescriptorOptions | undefined,
  );
}

export function pinBootPolicies(
  _context: KernelServiceModuleContext,
  instances: readonly object[],
): void {
  pinTerminalPoliciesForInstances(instances);
}