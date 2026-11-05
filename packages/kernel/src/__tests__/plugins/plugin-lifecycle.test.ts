import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStandardKernel } from '../../bootstrap/index.js';
import type { ServiceContext } from '../../contracts/lifecycle.js';
import type { IBrudToolsService } from '../../../services/BrudTools/contracts/index.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import { DurableNodeStorageDriver } from '../../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import { PluginManagerToken } from '../../../services/PluginManager/contracts/tokens.js';
import type { PluginManagerService } from '../../../services/PluginManager/orchestrator/PluginManagerService.js';
import { safeRm } from '../support/cleanup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = resolve(HERE, '../../../../plugins');

const USER_PROMPTS_ID = 'akkhar-labs.plugin.user-prompts';
const STRUCTURE_ID = 'akkhar-labs.plugin.structure';
const SEARCH_ID = 'akkhar-labs.plugin.search';

interface StructureModule {
  createStructurePlugin(): IBrudPlugin;
}

interface SearchModule {
  createSearchPlugin(): IBrudPlugin;
}

interface UserPromptsModule {
  createUserPromptsPlugin(): IBrudPlugin;
}

async function loadPluginModule<T>(packageName: string): Promise<T> {
  const entry = pathToFileURL(join(PLUGINS_ROOT, packageName, 'src', 'index.ts')).href;

  return await import(entry) as T;
}

function toolNamesOwnedBy(tools: IBrudToolsService, pluginId: string): string[] {
  return tools
    .listTools()
    .filter((tool) => tool.ownerPluginId === pluginId)
    .map((tool) => tool.name)
    .sort();
}

describe('plugin lifecycle invariant', () => {
  it('registers, activates, exposes tools, deactivates, and releases every resource', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-leaf-plugin-lifecycle-')));
    const driver = new DurableNodeStorageDriver();
    const kernel = createStandardKernel({
      storageDriver: driver,
      history: { dbPath: join(root, '.brud', 'history', 'universal.db') },
    });

    try {
      await kernel.boot({ workspaceRoot: root });

      const caller: ServiceContext = {
        callerId: 'test.leaf-plugin-lifecycle',
        tier: 'core',
        workspaceRoot: root,
      };
      const manager = kernel.requestAccess(caller, PluginManagerToken) as PluginManagerService;
      const tools = kernel.requestAccess(caller, BrudToolsToken);

      const userPrompts = await loadPluginModule<UserPromptsModule>('UserPrompts');
      const structure = await loadPluginModule<StructureModule>('Structure');
      const search = await loadPluginModule<SearchModule>('Search');

      manager.register(userPrompts.createUserPromptsPlugin());
      manager.register(structure.createStructurePlugin());
      manager.register(search.createSearchPlugin());

      assert.deepEqual(
        tools.listTools(),
        [],
        'registration must stay passive: no tool may appear before activation',
      );

      const expectedIds = [USER_PROMPTS_ID, STRUCTURE_ID, SEARCH_ID];
      assert.deepEqual([...manager.resolveActivationOrder()].sort(), [...expectedIds].sort());

      await manager.activateAll();

      for (const pluginId of expectedIds) {
        assert.equal(
          manager.getPlugin(pluginId)?.state,
          'active',
          `${pluginId} must be active after activateAll()`,
        );
      }

      assert.deepEqual(toolNamesOwnedBy(tools, STRUCTURE_ID), [
        'codebase_metadata',
        'extract_structure',
      ]);
      assert.deepEqual(toolNamesOwnedBy(tools, SEARCH_ID), ['search_files']);
      assert.deepEqual(toolNamesOwnedBy(tools, USER_PROMPTS_ID), []);
      assert.equal(tools.listTools().length, 3);

      await manager.deactivatePlugin(STRUCTURE_ID);

      assert.equal(manager.getPlugin(STRUCTURE_ID)?.state, 'unloaded');
      assert.deepEqual(toolNamesOwnedBy(tools, STRUCTURE_ID), []);
      assert.deepEqual(
        toolNamesOwnedBy(tools, SEARCH_ID),
        ['search_files'],
        'deactivating one plugin must not disturb another plugin',
      );

      await manager.deactivateAll();

      assert.deepEqual(tools.listTools(), [], 'every tool must leave the registry on deactivation');

      for (const pluginId of expectedIds) {
        assert.equal(manager.getPlugin(pluginId)?.state, 'unloaded');
      }
    } finally {
      try {
        await kernel.shutdown();
      } finally {
        await safeRm(root);
      }
    }

    assert.equal(
      existsSync(root),
      false,
      'the real workspace must be removable after shutdown: no file handle may survive',
    );
  });
});