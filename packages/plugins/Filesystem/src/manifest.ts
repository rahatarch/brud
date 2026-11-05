import type { PluginManifest } from '@brud/kernel';

/**
 * Declarative plugin metadata.
 *
 * Branding is deferred to pre-marketplace, so the manifest is explicitly
 * third-party. Kernel consumers that require official branding certify the
 * plugin instance before registration.
 */
export const filesystemManifest: PluginManifest = {
  id: 'akkhar-labs.plugin.filesystem',
  name: 'Brud Filesystem',
  version: '0.0.1',
  description: 'File and directory mutations for AI agents.',
  permissions: [
    'fs:read',
    'fs:write',
    'history:read',
    'history:write',
    'tools:register',
    'tools:execute',
  ],
  official: false,
};