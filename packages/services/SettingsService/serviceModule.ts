import type { KernelServiceModuleContext } from '@brud/kernel';
import type { SettingsDescriptorOptions } from './descriptor/descriptor.js';
import {
  SETTINGS_CONTEXT_SCOPE,
  SETTINGS_ROOT_CONTEXT_FIELD,
  createSettingsDescriptor,
  createSettingsReaderDescriptor,
} from './descriptor/descriptor.js';

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(SETTINGS_CONTEXT_SCOPE, [
    {
      name: SETTINGS_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute root of the workspace whose settings are loaded.',
    },
  ]);

  return createSettingsDescriptor(
    context.options['settings'] as SettingsDescriptorOptions | undefined,
  );
}

export function createSettingsReaderService(context: KernelServiceModuleContext) {
  void context;

  return createSettingsReaderDescriptor();
}
