import type { PluginManifest } from '@brud/kernel';

/** Declarative metadata for the official Terminal plugin. */
export const manifest: PluginManifest = {
  id: 'akkhar-labs.plugin.terminal',
  name: 'Brud Terminal',
  version: '0.0.1',
  description: 'Registers terminal_command and terminal_interactive over brud.core.terminal.',
  permissions: ['terminal:execute', 'tools:register'],
};

export default manifest;