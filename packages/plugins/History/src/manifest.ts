import type { PluginManifest } from '@brud/kernel';

export const manifest: PluginManifest = {
  id: 'akkhar-labs.plugin.history',
  name: 'Brud History',
  version: '0.0.1',
  description:
    'Registers session history tools and UI lifecycle actions over brud.core.universalHistory.',
  permissions: ['history:read', 'history:write', 'tools:register', 'actions:register'],
};

export default manifest;