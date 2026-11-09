import type { PluginManifest } from '@brud/kernel';

/** Declarative metadata for the official Terminal plugin. */
export const manifest: PluginManifest = {
  id: 'akkhar-labs.plugin.terminal',
  name: 'Brud Terminal',
  version: '0.0.1',
  description: 'Registers terminal tools and the UI process-management actions over brud.core.terminal.',
  permissions: ['terminal:execute', 'tools:register', 'actions:register'],
};

export default manifest;