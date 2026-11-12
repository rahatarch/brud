import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import type {
  IBrudToolsReader,
  ToolRegistrationOptions,
} from '../../BrudTools/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import type { IPluginHistoryService } from '../../UniversalHistory/contracts/index.js';
import type { NamespaceHistoryHandle } from '../../UniversalHistory/unified/service/types.js';
import type { IUtilityService } from '../../UtilityService/contracts/IUtilityService.js';
import { PluginPermissionError } from './errors.js';
import type { IBrudPlugin } from './IBrudPlugin.js';
import type { IPluginContext, IPluginDisposable } from './IPluginContext.js';
import { validatePluginManifest } from './manifest.js';
import type { PluginPermission } from './permissions.js';
import { PluginSubscriptions } from './PluginSubscriptions.js';

function createManifest() {
  const result = validatePluginManifest({
    id: 'acme.tools.core',
    name: 'Core Tools',
    version: '1.0.0',
    dependencies: ['acme.tools.shared'],
    permissions: ['tools:register'],
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.manifest;
}

function createContext(pluginId: string): IPluginContext {
  const permissions: ReadonlySet<PluginPermission> = new Set<PluginPermission>();

  return {
    pluginId,
    workspaceRoot: '/workspace',
    permissions,
    subscriptions: new PluginSubscriptions(),
    logger: {
      info: (): void => undefined,
      warn: (): void => undefined,
      error: (): void => undefined,
    },
    hasPermission: (permission: PluginPermission): boolean => permissions.has(permission),
    resolve: (): null => null,
    getFileSystem: (): IBrudFileSystem => {
      throw new PluginPermissionError(pluginId, 'getFileSystem', ['fs:read', 'fs:write']);
    },
    getUniversalHistory: (): IPluginHistoryService => {
      throw new PluginPermissionError(pluginId, 'getUniversalHistory', [
        'history:read',
        'history:write',
      ]);
    },
    getHistory: (): NamespaceHistoryHandle => {
      throw new PluginPermissionError(pluginId, 'getHistory', ['history:read', 'history:write']);
    },
    registerTool: (): IPluginDisposable => {
      throw new PluginPermissionError(pluginId, 'registerTool', ['tools:register', 'tools:execute']);
    },
    getBrudTools: (): IBrudToolsReader => {
      throw new PluginPermissionError(pluginId, 'getBrudTools', ['tools:register', 'tools:execute']);
    },
    getUtilities: (): IUtilityService => {
      throw new Error('utility service is not used in this test');
    },
    getTerminal: (): null => null,
    executeTool: (): Promise<OperationResult> => {
      throw new PluginPermissionError(pluginId, 'executeTool', ['tools:register', 'tools:execute']);
    },
    registerAction: (): IPluginDisposable => {
      throw new PluginPermissionError(pluginId, 'registerAction', ['actions:register']);
    },
  };
}

describe('IBrudPlugin contract', () => {
  it('supports plugins with both lifecycle hooks', async () => {
    const events: string[] = [];

    const plugin: IBrudPlugin = {
      manifest: createManifest(),
      activate: (context: IPluginContext): void => {
        events.push(`activate:${context.pluginId}`);
      },
      deactivate: async (): Promise<void> => {
        await Promise.resolve();
        events.push('deactivate');
      },
    };

    assert.equal(plugin.manifest.id, 'acme.tools.core');
    assert.deepEqual(plugin.manifest.dependencies, ['acme.tools.shared']);

    await plugin.activate(createContext(plugin.manifest.id));
    await plugin.deactivate?.();

    assert.deepEqual(events, ['activate:acme.tools.core', 'deactivate']);
  });

  it('allows plugins without a deactivate hook', () => {
    const plugin: IBrudPlugin = {
      manifest: createManifest(),
      activate: (): void => undefined,
    };

    assert.equal(plugin.deactivate, undefined);
  });
});
