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
import { BrudFileSystem } from '../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import { createFileSystemDescriptor } from '../../BrudFileSystem/descriptor/descriptor.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import type { IUniversalHistoryService } from '../../UniversalHistory/contracts/index.js';
import { UniversalHistoryToken } from '../../UniversalHistory/descriptor/tokens.js';
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

    await manager.initialize();

    assert.equal(harness.broker.fileSystemRequests, 1);
    assert.equal(state.fileSystem, harness.fileSystem);
    assert.equal(manager.getPlugin('acme.tools.core')?.state, 'active');

    await manager.dispose();
    assert.equal(manager.getPlugin('acme.tools.core')?.state, 'unloaded');
  });

  it('exposes the history facade when the history token is registered', async () => {
    const harness = createHarness({ withHistory: true });
    const state: ProbeState = {};
    const plugin = createProbePlugin('acme.tools.history', ['history:read'], state);
    const descriptor = createPluginManagerDescriptor({ initialPlugins: [plugin] });
    const manager = descriptor.factory(createCaller(), harness.broker);

    await manager.initialize();

    assert.equal(harness.broker.historyRequests, 1);
    assert.equal(state.universalHistory, harness.universalHistory);
    assert.equal(manager.getPlugin('acme.tools.history')?.state, 'active');

    await manager.dispose();
  });

  it('omits the history facade when the history token is absent', async () => {
    const harness = createHarness({ withHistory: false });
    const state: ProbeState = {};
    const plugin = createProbePlugin('acme.tools.history', ['history:read'], state);
    const descriptor = createPluginManagerDescriptor({
      initialPlugins: [plugin],
      withUniversalHistory: false,
    });
    const manager = descriptor.factory(createCaller(), harness.broker);

    await assert.rejects(
      () => manager.initialize(),
      (error: unknown) => {
        assert.ok(error instanceof PluginLifecycleError);
        assert.equal(error.code, 'PLUGIN_LIFECYCLE');
        assert.equal(error.pluginId, 'acme.tools.history');
        assert.match(error.message, /Universal history service is unavailable/u);
        return true;
      },
    );

    assert.equal(harness.broker.historyRequests, 0);
    assert.equal(state.universalHistory, undefined);
    assert.equal(manager.getPlugin('acme.tools.history')?.state, 'failed');
  });
});
