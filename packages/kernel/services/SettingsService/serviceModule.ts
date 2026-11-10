import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { SettingsDescriptorOptions } from './descriptor/descriptor.js';
import {
  createSettingsDescriptor,
  createSettingsReaderDescriptor,
} from './descriptor/descriptor.js';

export function createService(context: KernelServiceModuleContext) {
  return createSettingsDescriptor(
    context.options['settings'] as SettingsDescriptorOptions | undefined,
  );
}

export function createSettingsReaderService(context: KernelServiceModuleContext) {
  void context;

  return createSettingsReaderDescriptor();
}