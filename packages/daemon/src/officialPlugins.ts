import type { IBrudPlugin } from '@brud/kernel' with {
  'resolution-mode': 'import',
};

interface PluginModule {
  readonly searchPlugin?: IBrudPlugin;
  readonly structurePlugin?: IBrudPlugin;
  readonly userPromptsPlugin?: IBrudPlugin;
  readonly catalogPlugin?: IBrudPlugin;
  readonly readerPlugin?: IBrudPlugin;
  readonly filesystemPlugin?: IBrudPlugin;
  readonly historyPlugin?: IBrudPlugin;
  readonly terminalPlugin?: IBrudPlugin;
  readonly mcpBridgePlugin?: IBrudPlugin;
}

interface DefaultPluginModule {
  readonly plugin?: IBrudPlugin;
}

function requireModule<TModule>(specifier: string): TModule {
  // Plugin packages are loaded through their built entry points so this module
  // works both from `src/` (tsx) and from `dist/`. The daemon is CommonJS, and
  // Node can require the ESM plugin artifacts synchronously.
  return require(specifier) as TModule;
}

function loadPluginModules(): PluginModule {
  const terminal = requireModule<DefaultPluginModule>('../../plugins/Terminal/dist/index.js');
  const history = requireModule<DefaultPluginModule>('../../plugins/History/dist/index.js');
  const mcpBridge = requireModule<DefaultPluginModule>('../../plugins/MCPBridge/dist/index.js');

  return {
    ...requireModule<PluginModule>('../../plugins/Search/dist/index.js'),
    ...requireModule<PluginModule>('../../plugins/Structure/dist/index.js'),
    ...requireModule<PluginModule>('../../plugins/UserPrompts/dist/index.js'),
    ...requireModule<PluginModule>('../../plugins/Catalog/dist/index.js'),
    ...requireModule<PluginModule>('../../plugins/Reader/dist/index.js'),
    ...requireModule<PluginModule>('../../plugins/Filesystem/dist/index.js'),
    // Terminal, History, and MCPBridge export their singleton under the name
    // `plugin`, so they cannot be spread into one namespace without a
    // collision. They are loaded separately and re-keyed here.
    ...(history.plugin === undefined ? {} : { historyPlugin: history.plugin }),
    ...(terminal.plugin === undefined ? {} : { terminalPlugin: terminal.plugin }),
    ...(mcpBridge.plugin === undefined ? {} : { mcpBridgePlugin: mcpBridge.plugin }),
  };
}

function requirePlugin(
  modules: PluginModule,
  key: keyof PluginModule,
): IBrudPlugin {
  const plugin = modules[key];

  if (plugin === undefined) {
    throw new Error(`Official plugin module did not export "${String(key)}"`);
  }

  return plugin;
}

/**
 * Official plugin set registered into every daemon-spawned kernel.
 *
 * The six shipped leaf plugins plus the Phase 10 Terminal, the Phase 3B
 * History, and the MCPBridge plugins. The daemon composition passes
 * `certifyInitialPlugins: true` to the standard kernel so the Filesystem and
 * History plugins receive the internal official brand they need to reach the
 * core history service.
 */
export const OFFICIAL_PLUGINS: readonly IBrudPlugin[] = (() => {
  const modules = loadPluginModules();

  return Object.freeze([
    requirePlugin(modules, 'searchPlugin'),
    requirePlugin(modules, 'structurePlugin'),
    requirePlugin(modules, 'userPromptsPlugin'),
    requirePlugin(modules, 'catalogPlugin'),
    requirePlugin(modules, 'readerPlugin'),
    requirePlugin(modules, 'filesystemPlugin'),
    requirePlugin(modules, 'historyPlugin'),
    requirePlugin(modules, 'terminalPlugin'),
    requirePlugin(modules, 'mcpBridgePlugin'),
  ]);
})();