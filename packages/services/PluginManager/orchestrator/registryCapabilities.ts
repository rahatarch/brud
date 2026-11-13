import type { IExposedApiRegistry } from '@brud/kernel';
import type { PluginPermission } from '../contracts/permissions.js';
import { PluginManagerToken } from '../contracts/tokens.js';
import type { PluginCapabilityProviders } from '../contracts/PluginContext.js';
import type { InternalPluginRecord } from './types.js';

/**
 * Builds the Registry-backed resolver for one plugin context.
 *
 * The manager does not know which token backs which handle: every typed getter
 * and the generic `resolve` call one resolver, and the Exposed API Registry
 * performs broker resolution and projection selection.
 *
 * @param registry - Exposed API Registry resolved at plugin activation.
 * @param record - Plugin record supplying official status and id.
 * @param permissions - Capabilities declared by the plugin.
 * @param workspaceRoot - Absolute workspace root.
 */
export function createRegistryCapabilityProviders(
  registry: IExposedApiRegistry,
  record: InternalPluginRecord,
  permissions: readonly PluginPermission[],
  workspaceRoot: string,
): PluginCapabilityProviders {
  const access = {
    callerId: PluginManagerToken.id,
    tier: 'core' as const,
    workspaceRoot,
    official: record.official,
    subjectId: record.manifest.id,
  };

  return {
    resolveApi: (apiName: string): unknown | null =>
      registry.resolve(apiName, permissions, access),
  };
}