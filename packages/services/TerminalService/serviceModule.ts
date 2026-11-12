import type { KernelServiceModuleContext } from '@brud/kernel';
import type { TerminalDescriptorOptions } from './descriptor/TerminalDescriptor.js';
import {
  TERMINAL_CONTEXT_SCOPE,
  TERMINAL_ROOT_CONTEXT_FIELD,
  createTerminalDescriptor,
  pinTerminalPolicies as pinTerminalPoliciesForInstances,
} from './descriptor/TerminalDescriptor.js';

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(TERMINAL_CONTEXT_SCOPE, [
    {
      name: TERMINAL_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute workspace root used as the terminal working directory.',
    },
  ]);

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
