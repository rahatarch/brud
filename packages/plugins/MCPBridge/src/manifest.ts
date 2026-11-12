import type { PluginManifest } from '@brud/service-plugin-manager';

/** Declarative metadata for the official MCP bridge plugin. */
export const manifest: PluginManifest = {
  id: 'akkhar-labs.plugin.mcp-bridge',
  name: 'Brud MCP Bridge',
  version: '0.0.1',
  description: 'Declares stdio and loopback HTTP MCP transports and delegates tools to brud.core.tools.',
  permissions: ['tools:execute'],
  transports: ['stdio', 'mcp-http'],
};

export default manifest;