import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import type { ServiceInfo } from '../../../src/contracts/accessBroker.js';
import { KernelAccessBroker } from '../../../src/engine/KernelAccessBroker.js';
import { KernelRegistry } from '../../../src/engine/KernelRegistry.js';
import type { IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IBrudToolsService } from '../../BrudTools/contracts/index.js';
import { BrudToolsToken } from '../../BrudTools/descriptor/tokens.js';
import { BrudToolsService } from '../../BrudTools/orchestrator/BrudToolsService.js';
import { BrudFileSystem } from '../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import { createFileSystemDescriptor } from '../../BrudFileSystem/descriptor/descriptor.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import { ReadOnlyUniversalHistoryFacade } from '../../UniversalHistory/descriptor/ReadOnlyUniversalHistoryFacade.js';
import { UniversalHistoryToken } from '../../UniversalHistory/descriptor/tokens.js';
import { certifyOfficialPlugin } from '../contracts/branding.js';
import { PluginLifecycleError } from '../contracts/errors.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginContext } from '../contracts/IPluginContext.js';
import type { PluginManifest } from '../contracts/manifest.js';
import type { PluginPermission } from '../contracts/permissions.js';
import { PluginManagerToken } from '../contracts/tokens.js';
import { PluginManagerService } from '../orchestrator/PluginManagerService.js';
import {
  PLUGIN_MANAGER_SERVICE_TIER,
  PluginManagerDescriptor,
  createPluginManagerDescriptor,
} from './PluginManagerDescriptor.js';

const WORKSPACE_ROOT = '/workspace';

class UnusedUniversalHistory implements IUniversalHistoryService {
  async beginSession(): Promise<never> {
    throw new Error('history stub is not used in this test');
  }

  async commitSession(): Promise<never> {
    throw new Error('history stub is not used in this test');
  }

  async planReversal(): Promise<never> {
    throw new Error('history stub is not used in this test');
  }

  async executeReversal(): Promise<never> {
    throw new Error('history stub is not used in this test');
  }

  async getSession(): Promise<never> {
    throw new Error('history stub is not used in this test');
  }

  async listSessions(): Promise<never> {
    throw new Error('history stub is not used in this test');
  }
}

interface ProbeState {
  fileSystem?: IBrudFileSystem;
  universalHistory?: IUniversalHistoryService;
}

function createProbePlugin(
  id: string,
  permissions: readonly PluginPermission[],
  state: ProbeState,
): IBrudPlugin {
  const manifest: PluginManifest = {
    id,
    name: id,
    version: '1.0.0',
    permissions: [...permissions],
  };

  return {
    manifest,
    activate(context: IPluginContext): void {
      if (context.hasPermission('fs:read') || context.hasPermission('fs:write')) {
        state.fileSystem = context.getFileSystem();
      }

      if (context.hasPermission('history:read')) {
        state.universalHistory = context.getUniversalHistory();
      }
    },
  };
}

class CountingBroker implements IKernelAccessBroker {
  public fileSystemRequests = 0;

  public historyRequests = 0;

  private readonly inner: IKernelAccessBroker;

  constructor(inner: IKernelAccessBroker) {
    this.inner = inner;
  }

  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    if (token === FileSystemToken) {
      this.fileSystemRequests += 1;
    }

    if (token === UniversalHistoryToken) {
      this.historyRequests += 1;
    }

    return this.inner.requestAccess(caller, token);
  }

  hasService(token: ServiceToken<unknown>): boolean {
    return this.inner.hasService(token);
  }

  listServices(): readonly ServiceInfo[] {
    return this.inner.listServices();
  }
}

interface HarnessOptions {
  readonly withHistory?: boolean;
  readonly withTools?: boolean;
}

interface Harness {
  readonly broker: CountingBroker;
  readonly fileSystem: IBrudFileSystem;
  readonly universalHistory: IUniversalHistoryService;
}

function createHarness(options?: HarnessOptions): Harness {
  const registry = new KernelRegistry();
  const driver = new InMemoryStorageDriver();
  const fileSystem = new BrudFileSystem(WORKSPACE_ROOT, driver);
  const universalHistory = new UnusedUniversalHistory();

  registry.register(createFileSystemDescriptor({ driver }));
  registry.setInstance(FileSystemToken.id, fileSystem);

  if (options?.withHistory !== false) {
    const historyDescriptor: ServiceDescriptor<IUniversalHistoryService> = {
      token: UniversalHistoryToken,
      tier: 'core',
      dependencies: [FileSystemToken],
      factory: (): IUniversalHistoryService => universalHistory,
    };

    registry.register(historyDescriptor);
    registry.setInstance(UniversalHistoryToken.id, universalHistory);
  }

  if (options?.withTools === true) {
    const toolsDescriptor: ServiceDescriptor<IBrudToolsService> = {
      token: BrudToolsToken,
      tier: 'core',
      dependencies: [],
      factory: (): BrudToolsService => new BrudToolsService(),
    };

    registry.register(toolsDescriptor);
    registry.setInstance(BrudToolsToken.id, new BrudToolsService());
  }

  return {
    broker: new CountingBroker(new KernelAccessBroker(registry, () => 'RUNNING')),
    fileSystem,
    universalHistory,
  };
}

function createCaller(): ServiceContext {
  return {
    callerId: 'plugin-manager-descriptor-suite',
    tier: PLUGIN_MANAGER_SERVICE_TIER,
    workspaceRoot: WORKSPACE_ROOT,
  };
}

describe('createPluginManagerDescriptor', () => {
  it('describes a core service bound to the plugin manager token', () => {
    const descriptor = createPluginManagerDescriptor();

    assert.equal(descriptor.token, PluginManagerToken);
    assert.equal(descriptor.tier, 'core');
    assert.equal(PluginManagerToken.id, 'PluginManager');
    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      [FileSystemToken.id],
    );
  });

  it('declares the history dependency when the composition opts in', () => {
    const descriptor = createPluginManagerDescriptor({ withUniversalHistory: true });

    assert.equal(descriptor.tier, 'core');
    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      [FileSystemToken.id, UniversalHistoryToken.id],
    );
  });

  it('exports a standard descriptor with no initial plugins', () => {
    assert.equal(PluginManagerDescriptor.token, PluginManagerToken);
    assert.equal(PluginManagerDescriptor.tier, 'core');
    assert.deepEqual(
      PluginManagerDescriptor.dependencies.map((token) => token.id),
      [FileSystemToken.id],
    );
  });

  it('registers initial plugins as unloaded without resolving dependencies eagerly', () => {
    const harness = createHarness();
    const state: ProbeState = {};
    const plugin = createProbePlugin('acme.tools.core', ['fs:read'], state);
    const descriptor = createPluginManagerDescriptor({ initialPlugins: [plugin] });

    const manager = descriptor.factory(createCaller(), harness.broker);

    assert.ok(manager instanceof PluginManagerService);
    assert.equal(harness.broker.fileSystemRequests, 0);
    assert.equal(harness.broker.historyRequests, 0);
    assert.equal(manager.listPlugins().length, 1);
    assert.equal(manager.getPlugin('acme.tools.core')?.state, 'unloaded');
    assert.equal(state.fileSystem, undefined);
  });

  it('resolves the filesystem lazily when a plugin activates', async () => {
    const harness = createHarness();
    const state: ProbeState = {};
    const plugin = createProbePlugin('acme.tools.core', ['fs:write'], state);
    const descriptor = createPluginManagerDescriptor({ initialPlugins: [plugin] });
    const manager = descriptor.factory(createCaller(), harness.broker);

    await manager.onRunning();

    assert.equal(harness.broker.fileSystemRequests, 1);
    assert.equal(state.fileSystem, harness.fileSystem);
    assert.equal(manager.getPlugin('acme.tools.core')?.state, 'active');

    await manager.dispose();
    assert.equal(manager.getPlugin('acme.tools.core')?.state, 'unloaded');
  });

  it('exposes the history facade when the history token is registered', async () => {
    const harness = createHarness({ withHistory: true });
    const state: ProbeState = {};
    // Official since D-15 U-6: the core session history is official-only.
    const plugin = certifyOfficialPlugin(createProbePlugin('brud.probe.history', ['history:read'], state));
    const descriptor = createPluginManagerDescriptor({ initialPlugins: [plugin] });
    const manager = descriptor.factory(createCaller(), harness.broker);

    await manager.onRunning();

    assert.equal(harness.broker.historyRequests, 1);
    assert.ok(state.universalHistory instanceof ReadOnlyUniversalHistoryFacade);
    assert.equal(manager.getPlugin('brud.probe.history')?.state, 'active');

    await manager.dispose();
  });

  it('omits the history facade when the history token is absent', async () => {
    const harness = createHarness({ withHistory: false });
    const state: ProbeState = {};
    // Official since D-15 U-6: the core session history is official-only.
    const plugin = certifyOfficialPlugin(createProbePlugin('brud.probe.history', ['history:read'], state));
    const descriptor = createPluginManagerDescriptor({
      initialPlugins: [plugin],
      withUniversalHistory: false,
    });
    const manager = descriptor.factory(createCaller(), harness.broker);

    await assert.rejects(
      () => manager.onRunning(),
      (error: unknown) => {
        assert.ok(error instanceof PluginLifecycleError);
        assert.equal(error.code, 'PLUGIN_LIFECYCLE');
        assert.equal(error.pluginId, 'brud.probe.history');
        assert.match(error.message, /Universal history service is unavailable/u);
        return true;
      },
    );

    assert.equal(harness.broker.historyRequests, 0);
    assert.equal(state.universalHistory, undefined);
    assert.equal(manager.getPlugin('brud.probe.history')?.state, 'failed');
  });
});

describe('createPluginManagerDescriptor tool composition', () => {
  it('omits the tools dependency unless the composition opts in', () => {
    const descriptor = createPluginManagerDescriptor({ withUniversalHistory: true });

    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      [FileSystemToken.id, UniversalHistoryToken.id],
    );
  });

  it('declares the tools dependency when the composition opts in', () => {
    const descriptor = createPluginManagerDescriptor({
      withUniversalHistory: true,
      withTools: true,
    });

    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      [FileSystemToken.id, UniversalHistoryToken.id, BrudToolsToken.id],
    );
  });

  it('registers and executes plugin tools against the brokered registry', async () => {
    const harness = createHarness({ withTools: true });
    const plugin = createProbePlugin(
      'acme.tools.brokered',
      ['tools:register', 'tools:execute'],
      {},
    );
    const pluginWithTools: IBrudPlugin = {
      manifest: plugin.manifest,
      activate: async (context: IPluginContext): Promise<void> => {
        context.registerTool({
          name: 'acme_brokered',
          description: 'Brokered',
          parametersSchema: {},
          execute: async (): Promise<{ status: 'success' }> => ({ status: 'success' }),
        });
        const result = await context.executeTool('acme_brokered', {});
        assert.equal(result.status, 'success');
      },
    };
    const descriptor = createPluginManagerDescriptor({
      initialPlugins: [pluginWithTools],
      withTools: true,
    });
    const manager = descriptor.factory(createCaller(), harness.broker);

    await manager.onRunning();

    assert.equal(manager.getPlugin('acme.tools.brokered')?.state, 'active');

    await manager.dispose();
  });
});
