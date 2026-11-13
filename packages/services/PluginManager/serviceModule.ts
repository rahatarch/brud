import {
  ContextContractError,
  type KernelServiceModuleContext,
} from '@brud/kernel';
import { BrandRegistryToken } from '../BrandRegistry/contracts/tokens.js';
import { requireBrandRegistry } from '../BrandRegistry/serviceModule.js';
import type { IBrudPlugin } from './contracts/IBrudPlugin.js';
import { PluginManagerToken } from './contracts/tokens.js';
import {
  PLUGIN_MANAGER_CERTIFY_CONTEXT_FIELD,
  PLUGIN_MANAGER_CONFIG_PATH_CONTEXT_FIELD,
  PLUGIN_MANAGER_CONTEXT_SCOPE,
  PLUGIN_MANAGER_PLUGINS_CONTEXT_FIELD,
  PLUGIN_MANAGER_ROOT_CONTEXT_FIELD,
  createPluginManagerDescriptor,
} from './descriptor/index.js';
import { loadConfiguredPlugins } from './pluginConfig.js';

/** Brand scope name owned by the plugin manager for its plugin brands. */
export const PLUGIN_MANAGER_SCOPE_NAME = PluginManagerToken.id;

/**
 * Builds the plugin manager from the host's own namespace.
 *
 * The manager declares the fields it accepts and owns both plugin paths: a
 * host-supplied instance override, and config-based loading when the host
 * supplies the composition document path. The kernel carries neither.
 */
export async function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(PLUGIN_MANAGER_CONTEXT_SCOPE, [
    {
      name: PLUGIN_MANAGER_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute workspace root exposed to plugins through the manager.',
    },
    {
      name: PLUGIN_MANAGER_CONFIG_PATH_CONTEXT_FIELD,
      type: 'string',
      required: false,
      description: 'Composition document the manager loads its plugin entries from.',
    },
    {
      name: PLUGIN_MANAGER_PLUGINS_CONTEXT_FIELD,
      type: 'object',
      required: false,
      description: 'Host-supplied plugin instances as an object with an entries array.',
    },
    {
      name: PLUGIN_MANAGER_CERTIFY_CONTEXT_FIELD,
      type: 'boolean',
      required: false,
      description: 'Whether the host-supplied plugin instances are official in this composition.',
    },
  ]);

  const hostPlugins = hostPluginEntries(context);
  const certifyHost = context.options[PLUGIN_MANAGER_CERTIFY_CONTEXT_FIELD] === true;

  let initialPlugins: readonly IBrudPlugin[];
  let officialPlugins: readonly object[];

  if (hostPlugins !== undefined) {
    initialPlugins = hostPlugins;
    officialPlugins = certifyHost ? hostPlugins : [];
  } else {
    const configPath = context.options[PLUGIN_MANAGER_CONFIG_PATH_CONTEXT_FIELD];
    const loaded = typeof configPath === 'string' && configPath.length > 0
      ? await loadConfiguredPlugins(configPath)
      : { plugins: [], officialPlugins: [] };

    initialPlugins = loaded.plugins;
    officialPlugins = loaded.officialPlugins;
  }

  const descriptor = createPluginManagerDescriptor({
    ...(initialPlugins.length === 0 ? {} : { initialPlugins }),
    ...(officialPlugins.length === 0 ? {} : { officialPlugins }),
    brandScopeProvider: () => {
      const registry = requireBrandRegistry(context);

      return registry.getScope(PLUGIN_MANAGER_SCOPE_NAME)
        ?? registry.createScope(PLUGIN_MANAGER_SCOPE_NAME);
    },
    withUniversalHistory: true,
    withTools: true,
    withUtilities: true,
    withActions: true,
  });

  return {
    ...descriptor,
    dependencies: [BrandRegistryToken, ...descriptor.dependencies],
  };
}

function hostPluginEntries(
  context: KernelServiceModuleContext,
): readonly IBrudPlugin[] | undefined {
  const value = context.options[PLUGIN_MANAGER_PLUGINS_CONTEXT_FIELD];

  if (value === undefined) {
    return undefined;
  }

  if (
    value === null
    || typeof value !== 'object'
    || !Array.isArray((value as { readonly entries?: unknown }).entries)
  ) {
    throw new ContextContractError(
      `Context field "${PLUGIN_MANAGER_PLUGINS_CONTEXT_FIELD}" must be an object with an "entries" array.`,
      {
        field: PLUGIN_MANAGER_PLUGINS_CONTEXT_FIELD,
        service: PLUGIN_MANAGER_CONTEXT_SCOPE,
        expectedType: 'object',
        actualType: Array.isArray(value) ? 'array' : typeof value,
      },
    );
  }

  return (value as { readonly entries: readonly IBrudPlugin[] }).entries;
}