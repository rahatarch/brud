import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { BrandRegistryToken } from '../BrandRegistry/contracts/tokens.js';
import { requireBrandRegistry } from '../BrandRegistry/serviceModule.js';
import type { IBrudPlugin } from './contracts/IBrudPlugin.js';
import { PluginManagerToken } from './contracts/tokens.js';
import { createPluginManagerDescriptor } from './descriptor/index.js';

/** Brand scope name owned by the plugin manager for its plugin brands. */
export const PLUGIN_MANAGER_SCOPE_NAME = PluginManagerToken.id;

export function createService(context: KernelServiceModuleContext) {
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
    withTerminal: true,
    withActions: true,
  });

  return {
    ...descriptor,
    dependencies: [BrandRegistryToken, ...descriptor.dependencies],
  };
}