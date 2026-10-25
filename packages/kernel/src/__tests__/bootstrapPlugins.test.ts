import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IStorageDriver } from '../../drivers/contracts/index.js';
import { InMemoryStorageDriver } from '../../drivers/memory/index.js';
import type { IBrudFileSystem } from '../../services/BrudFileSystem/contracts/index.js';
import { BrudFileSystem } from '../../services/BrudFileSystem/orchestrator/BrudFileSystem.js';
import { FileSystemToken } from '../../services/BrudFileSystem/descriptor/tokens.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import type { PluginManifest } from '../../services/PluginManager/contracts/manifest.js';
import type { PluginPermission } from '../../services/PluginManager/contracts/permissions.js';
import { PluginManagerToken } from '../../services/PluginManager/contracts/tokens.js';
import { createPluginManagerDescriptor } from '../../services/PluginManager/descriptor/index.js';
import { PluginManagerService } from '../../services/PluginManager/orchestrator/PluginManagerService.js';
import { createUniversalHistoryDescriptor } from '../../services/UniversalHistory/descriptor/index.js';
import { createStandardKernel } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { BrudKernel } from '../engine/BrudKernel.js';

const WORKSPACE_ROOT = '/workspace';

function createCaller(overrides?: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'test.plugins',
    tier: 'core',
    workspaceRoot: WORKSPACE_ROOT,
    ...overrides,
  };
}

interface RecordingPluginOptions {
  readonly id: string;
  readonly log: string[];
  readonly dependencies?: readonly string[];
  readonly permissions?: readonly PluginPermission[];
}

function createRecordingPlugin(options: RecordingPluginOptions): IBrudPlugin {
  const manifest: PluginManifest = {
    id: options.id,
    name: options.id,
    version: '1.0.0',
    permissions: [...(options.permissions ?? [])],
    dependencies: [...(options.dependencies ?? [])],
  };

  return {
    manifest,
    activate: (): void => {
      options.log.push(`activate:${options.id}`);
    },
    deactivate: (): void => {
      options.log.push(`deactivate:${options.id}`);
    },
  };
}

class TracingFileSystem extends BrudFileSystem {
  private readonly log: string[];

  constructor(workspaceRoot: string, driver: IStorageDriver, log: string[]) {
    super(workspaceRoot, driver);
    this.log = log;
  }

  override async initialize(): Promise<void> {
    this.log.push('initialize:filesystem');
    await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.log.push('dispose:filesystem');
    await super.dispose();
  }
}

function createTracingFileSystemDescriptor(
  log: string[],
): ServiceDescriptor<IBrudFileSystem, BrudFileSystem> {
  return {
    token: FileSystemToken,
    tier: 'core',
    dependencies: [],
    factory: (context: ServiceContext): TracingFileSystem =>
      new TracingFileSystem(context.workspaceRoot, new InMemoryStorageDriver(), log),
  };
}

describe('createStandardKernel plugin integration', () => {
  it('resolves the running plugin manager through the access broker', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      const manager = kernel.requestAccess(createCaller(), PluginManagerToken);

      assert.ok(manager instanceof PluginManagerService);
      assert.equal(manager.listPlugins().length, 0);
      assert.deepEqual(manager.resolveActivationOrder(), []);
    } finally {
      await kernel.shutdown();
    }
  });

  it('activates initial plugins in dependency order when boot resolves', async () => {
    const log: string[] = [];
    const alpha = createRecordingPlugin({ id: 'acme.alpha', log });
    const beta = createRecordingPlugin({
      id: 'acme.beta',
      log,
      dependencies: ['acme.alpha'],
    });

    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      initialPlugins: [beta, alpha],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    const manager = kernel.requestAccess(createCaller(), PluginManagerToken);

    assert.deepEqual(manager.resolveActivationOrder(), ['acme.alpha', 'acme.beta']);
    assert.deepEqual(log, ['activate:acme.alpha', 'activate:acme.beta']);
    assert.deepEqual(
      manager.listPlugins().map((record) => record.state),
      ['active', 'active'],
    );

    await kernel.shutdown();

    assert.deepEqual(log, [
      'activate:acme.alpha',
      'activate:acme.beta',
      'deactivate:acme.beta',
      'deactivate:acme.alpha',
    ]);
    assert.equal(manager.getPlugin('acme.alpha')?.state, 'unloaded');
    assert.equal(manager.getPlugin('acme.beta')?.state, 'unloaded');
  });

  it('deactivates plugins before the filesystem service stops', async () => {
    const log: string[] = [];
    const plugin = createRecordingPlugin({ id: 'acme.sequenced', log });
    const kernel = new BrudKernel();

    kernel.register(createTracingFileSystemDescriptor(log));
    kernel.register(createUniversalHistoryDescriptor({ inMemory: true }));
    kernel.register(createPluginManagerDescriptor({ initialPlugins: [plugin] }));

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    assert.deepEqual(log, ['initialize:filesystem', 'activate:acme.sequenced']);

    await kernel.shutdown();

    assert.deepEqual(log, [
      'initialize:filesystem',
      'activate:acme.sequenced',
      'deactivate:acme.sequenced',
      'dispose:filesystem',
    ]);
  });
});
