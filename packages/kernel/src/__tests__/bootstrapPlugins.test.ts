import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IStorageDriver } from '../../drivers/contracts/index.js';
import { InMemoryStorageDriver } from '../../drivers/memory/index.js';
import type { IBrudFileSystem } from '../../services/BrudFileSystem/contracts/index.js';
import { BrudFileSystem } from '../../services/BrudFileSystem/orchestrator/BrudFileSystem.js';
import { FileSystemToken } from '../../services/BrudFileSystem/descriptor/tokens.js';
import { BrudToolsToken } from '../../services/BrudTools/descriptor/tokens.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import { PluginLifecycleError } from '../../services/PluginManager/contracts/errors.js';
import type { IPluginContext } from '../../services/PluginManager/contracts/IPluginContext.js';
import type { PluginManifest } from '../../services/PluginManager/contracts/manifest.js';
import type { PluginPermission } from '../../services/PluginManager/contracts/permissions.js';
import { PluginManagerToken } from '../../services/PluginManager/contracts/tokens.js';
import { createPluginManagerDescriptor } from '../../services/PluginManager/descriptor/index.js';
import { PluginManagerService } from '../../services/PluginManager/orchestrator/PluginManagerService.js';
import { certifyOfficialPlugin } from '../../services/PluginManager/contracts/branding.js';
import type { IUniversalHistoryService } from '../../services/UniversalHistory/contracts/index.js';
import {
  ReadOnlyUniversalHistoryFacade,
  UniversalHistoryReadOnlyViolationError,
  createUniversalHistoryDescriptor,
} from '../../services/UniversalHistory/descriptor/index.js';
import { createStandardKernel } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { BrudKernel } from '../engine/BrudKernel.js';
import { LifecycleStateError } from '../engine/errors.js';

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

// ── Boot-time capability grants (Phase 5 C-1, G-9) ──────────────

function createCapabilityPlugin(
  id: string,
  permissions: readonly PluginPermission[],
  activate: (context: IPluginContext) => Promise<void> | void,
): IBrudPlugin {
  return {
    manifest: { id, name: id, version: '1.0.0', permissions: [...permissions], dependencies: [] },
    activate,
  };
}

describe('plugin capabilities requested during activation at boot', () => {
  it('grants the filesystem during activate() and the handle reads a seeded file', async () => {
    const driver = new InMemoryStorageDriver();
    await driver.mkdir(WORKSPACE_ROOT, { recursive: true });
    await driver.writeFile(`${WORKSPACE_ROOT}/seed.txt`, 'seeded content');
    let readBack: string | undefined;

    const kernel = createStandardKernel({
      storageDriver: driver,
      history: { inMemory: true },
      initialPlugins: [
        createCapabilityPlugin('acme.boot.fs', ['fs:read'], async (context) => {
          readBack = await context.getFileSystem().readText('seed.txt');
        }),
      ],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.equal(readBack, 'seeded content');
      const manager = kernel.requestAccess(createCaller(), PluginManagerToken);
      assert.equal(manager.getPlugin('acme.boot.fs')?.state, 'active');
    } finally {
      await kernel.shutdown();
    }
  });

  it('registers a tool during activate() and the tool is routable after boot', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      initialPlugins: [
        createCapabilityPlugin('acme.boot.tools', ['tools:register'], (context) => {
          context.registerTool({
            name: 'acme_boot_tool',
            description: 'Registered during boot-time activation.',
            parametersSchema: { type: 'object' },
            execute: async () => ({ status: 'success' }),
          });
        }),
      ],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      const tools = kernel.requestAccess(createCaller(), BrudToolsToken);
      const registered = tools.listTools().find((tool) => tool.name === 'acme_boot_tool');

      assert.ok(registered);
      assert.equal(registered.ownerPluginId, 'acme.boot.tools');
      assert.equal(tools.getTool('acme_boot_tool')?.name, 'acme_boot_tool');
    } finally {
      await kernel.shutdown();
    }
  });

  it('grants universal history during activate()', async () => {
    let historyResolved = false;
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      initialPlugins: [
        createCapabilityPlugin('acme.boot.history', ['history:read'], (context) => {
          historyResolved = context.getUniversalHistory() !== undefined;
        }),
      ],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.equal(historyResolved, true);
    } finally {
      await kernel.shutdown();
    }
  });

  it('rolls the kernel back to DISPOSED when a plugin fails to activate at boot', async () => {
    const log: string[] = [];
    const stable = createRecordingPlugin({ id: 'acme.stable', log });
    const broken: IBrudPlugin = {
      manifest: {
        id: 'acme.broken',
        name: 'acme.broken',
        version: '1.0.0',
        permissions: ['fs:read'],
        dependencies: ['acme.stable'],
      },
      activate: (context): void => {
        // The broker is open: this capability request must succeed before the
        // plugin fails on its own.
        context.getFileSystem();
        log.push('activate:acme.broken');
        throw new Error('broken plugin refused to start');
      },
    };
    const kernel = new BrudKernel();

    kernel.register(createTracingFileSystemDescriptor(log));
    kernel.register(createUniversalHistoryDescriptor({ inMemory: true }));
    kernel.register(createPluginManagerDescriptor({ initialPlugins: [broken, stable] }));

    await assert.rejects(
      () => kernel.boot({ workspaceRoot: WORKSPACE_ROOT }),
      (error: unknown) => {
        assert.ok(error instanceof PluginLifecycleError);
        assert.equal(error.pluginId, 'acme.broken');
        assert.match(error.message, /broken plugin refused to start/u);
        return true;
      },
    );

    assert.equal(kernel.lifecycleState, 'DISPOSED');
    assert.deepEqual(log, [
      'initialize:filesystem',
      'activate:acme.stable',
      'activate:acme.broken',
      'deactivate:acme.stable',
      'dispose:filesystem',
    ]);
    assert.throws(
      () => kernel.requestAccess(createCaller(), PluginManagerToken),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleStateError);
        assert.equal(error.code, 'INVALID_LIFECYCLE_STATE');
        return true;
      },
    );
  });

  it('gives a history:read plugin a read-only universal history', async () => {
    let history: IUniversalHistoryService | undefined;
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      initialPlugins: [
        createCapabilityPlugin('acme.history.reader', ['history:read'], (context) => {
          history = context.getUniversalHistory();
        }),
      ],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.ok(history instanceof ReadOnlyUniversalHistoryFacade);
      await assert.rejects(
        () => history!.beginSession('plugin write attempt', []),
        (error: unknown) => {
          assert.ok(error instanceof UniversalHistoryReadOnlyViolationError);
          assert.equal(error.code, 'READ_ONLY_VIOLATION');
          assert.equal(error.operation, 'beginSession');
          return true;
        },
      );
      assert.ok(Array.isArray(await history.listSessions()));
    } finally {
      await kernel.shutdown();
    }
  });

  it('keeps a third-party plugin declaring history:write read-only', async () => {
    let history: IUniversalHistoryService | undefined;
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      initialPlugins: [
        createCapabilityPlugin('acme.history.writer', ['history:read', 'history:write'], (context) => {
          history = context.getUniversalHistory();
        }),
      ],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.ok(history instanceof ReadOnlyUniversalHistoryFacade);
      await assert.rejects(
        () => history!.beginSession('third-party write attempt', []),
        (error: unknown) => {
          assert.ok(error instanceof UniversalHistoryReadOnlyViolationError);
          assert.equal(error.code, 'READ_ONLY_VIOLATION');
          return true;
        },
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('gives an official plugin declaring history:write the full universal history', async () => {
    let history: IUniversalHistoryService | undefined;
    const official = certifyOfficialPlugin(
      createCapabilityPlugin('brud.probe.history', ['history:read', 'history:write'], (context) => {
        history = context.getUniversalHistory();
      }),
    );
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      initialPlugins: [official],
    });

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    try {
      assert.ok(history !== undefined);
      assert.equal(history instanceof ReadOnlyUniversalHistoryFacade, false);
      const sessionId = await history.beginSession('official write', []);
      assert.match(sessionId, /^BR-\d{8}-\d{3,}$/u);
    } finally {
      await kernel.shutdown();
    }
  });

  it('does not activate plugins in PluginManagerService.initialize()', async () => {
    const log: string[] = [];
    const manager = new PluginManagerService({
      workspaceRoot: WORKSPACE_ROOT,
      fileSystem: (): IBrudFileSystem => {
        throw new Error('filesystem must not be resolved during initialize()');
      },
    });

    manager.register(createRecordingPlugin({ id: 'acme.staged', log }));
    await manager.initialize();

    assert.equal(manager.getPlugin('acme.staged')?.state, 'unloaded');
    assert.deepEqual(log, []);

    await manager.onRunning();

    assert.equal(manager.getPlugin('acme.staged')?.state, 'active');
    assert.deepEqual(log, ['activate:acme.staged']);

    await manager.dispose();
  });
});
