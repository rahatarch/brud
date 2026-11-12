import type { KernelServiceModuleContext } from '@brud/kernel';
import { BrandRegistryToken } from '../BrandRegistry/contracts/tokens.js';
import { requireBrandRegistry } from '../BrandRegistry/serviceModule.js';
import type { IBrudPlugin } from './contracts/IBrudPlugin.js';
import { PluginManagerToken } from './contracts/tokens.js';
import {
  PLUGIN_MANAGER_CONTEXT_SCOPE,
  PLUGIN_MANAGER_ROOT_CONTEXT_FIELD,
  createPluginManagerDescriptor,
} from './descriptor/index.js';

/** Brand scope name owned by the plugin manager for its plugin brands. */
export const PLUGIN_MANAGER_SCOPE_NAME = PluginManagerToken.id;

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(PLUGIN_MANAGER_CONTEXT_SCOPE, [
    {
      name: PLUGIN_MANAGER_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute workspace root exposed to plugins through the manager.',
    },
  ]);

  const initialPlugins = context.options['plugins'] as unknown as
    | readonly IBrudPlugin[]
    | undefined;
  const officialPlugins = context.options['officialPlugins'] as
    | readonly object[]
    | undefined;

  const descriptor = createPluginManagerDescriptor({
    ...(initialPlugins === undefined ? {} : { initialPlugins }),
    ...(officialPlugins === undefined ? {} : { officialPlugins }),
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
