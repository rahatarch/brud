import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  DirectoryEntry,
  FileStats,
} from '../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/index.js';
import { ReadOnlyViolationError } from '../../BrudFileSystem/projection/index.js';
import {
  PluginDuplicateError,
  PluginLifecycleError,
  PluginPermissionError,
} from '../contracts/errors.js';
import type { IBrudPlugin } from '../contracts/IBrudPlugin.js';
import type { IPluginContext } from '../contracts/IPluginContext.js';
import type { PluginPermission } from '../contracts/permissions.js';
import type { PluginManifest } from '../contracts/manifest.js';
import { PluginManagerService } from './PluginManagerService.js';
import {
  PluginActiveDependencyError,
  PluginManifestValidationError,
} from './types.js';

const WORKSPACE_ROOT = '/workspace';

class RecordingFileSystem implements IBrudFileSystem {
  public readonly writes: string[] = [];

  public readFile(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  public readText(): Promise<string> {
    return Promise.resolve('');
  }

  public writeAtomic(relativePath: string): Promise<void> {
    this.writes.push(relativePath);
    return Promise.resolve();
  }

  public createFile(relativePath: string): Promise<void> {
    this.writes.push(relativePath);
    return Promise.resolve();
  }

  public deleteFile(relativePath: string): Promise<void> {
    this.writes.push(relativePath);
    return Promise.resolve();
  }

  public readDirectory(): Promise<readonly DirectoryEntry[]> {
    return Promise.resolve([]);
  }

  public stat(): Promise<FileStats | null> {
    return Promise.resolve(null);
  }

  public exists(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

interface PluginOptions {
  readonly id: string;
  readonly dependencies?: readonly string[];
  readonly permissions?: readonly PluginPermission[];
  readonly log?: string[];
  readonly activationError?: unknown;
  readonly deactivationError?: unknown;
  readonly onActivate?: (context: IPluginContext) => Promise<void> | void;
  readonly onDeactivate?: () => Promise<void> | void;
}

function createPlugin(options: PluginOptions): IBrudPlugin {
  const manifest: PluginManifest = {
    id: options.id,
    name: options.id,
    version: '1.0.0',
    permissions: [...(options.permissions ?? [])],
    dependencies: [...(options.dependencies ?? [])],
  };

  return {
    manifest,
    activate: async (context: IPluginContext): Promise<void> => {
      options.log?.push(`activate:${options.id}`);
      await options.onActivate?.(context);

      if (options.activationError !== undefined) {
        throw options.activationError;
      }
    },
    deactivate: async (): Promise<void> => {
      options.log?.push(`deactivate:${options.id}`);
      await options.onDeactivate?.();

      if (options.deactivationError !== undefined) {
        throw options.deactivationError;
      }
    },
  };
}

function createSubscriptionPlugin(
  options: PluginOptions,
): IBrudPlugin {
  const log = options.log;
  const pluginId = options.id;

  return createPlugin({
    ...options,
    onActivate: async (context: IPluginContext): Promise<void> => {
      context.subscriptions.add({
        dispose: (): void => {
          log?.push(`dispose:${pluginId}`);
        },
      });
      await options.onActivate?.(context);
    },
  });
}

function createManager(
  fileSystem: IBrudFileSystem = new RecordingFileSystem(),
): PluginManagerService {
  return new PluginManagerService({
    workspaceRoot: WORKSPACE_ROOT,
    fileSystem: () => fileSystem,
  });
}

describe('PluginManagerService registration', () => {
  it('registers a valid plugin as unloaded', () => {
    const manager = createManager();
    const plugin = createPlugin({ id: 'brud.tools.core' });

    manager.register(plugin);

    const record = manager.getPlugin('brud.tools.core');

    assert.ok(record !== undefined);
    assert.equal(record.plugin, plugin);
    assert.equal(record.state, 'unloaded');
    assert.equal(record.activatedAt, undefined);
    assert.deepEqual(
      manager.listPlugins().map((entry) => entry.plugin.manifest.id),
      ['brud.tools.core'],
    );
  });

  it('rejects duplicate registrations', () => {
    const manager = createManager();
    manager.register(createPlugin({ id: 'brud.tools.core' }));

    assert.throws(
      () => manager.register(createPlugin({ id: 'brud.tools.core' })),
      (error: unknown) => {
        assert.ok(error instanceof PluginDuplicateError);
        assert.equal(error.code, 'PLUGIN_DUPLICATE');
        assert.equal(error.pluginId, 'brud.tools.core');
        return true;
      },
    );
  });

  it('rejects an invalid manifest with a validation domain error', () => {
    const manager = createManager();
    const invalid: IBrudPlugin = {
      manifest: {
        id: 'brud.tools.invalid',
        name: 'Invalid Tools',
        version: '1.0',
        permissions: [],
      },
      activate: (): void => undefined,
    };

    assert.throws(
      () => manager.register(invalid),
      (error: unknown) => {
        assert.ok(error instanceof PluginManifestValidationError);
        assert.equal(error.code, 'PLUGIN_MANIFEST');
        assert.equal(error.pluginId, 'brud.tools.invalid');
        assert.match(error.reason, /manifest\.version/);
        return true;
      },
    );
    assert.equal(manager.getPlugin('brud.tools.invalid'), undefined);
  });
});

describe('PluginManagerService batch activation', () => {
  it('activates independent plugins cleanly', async () => {
    const log: string[] = [];
    const manager = createManager();

    manager.register(createPlugin({ id: 'alpha', log }));
    manager.register(createPlugin({ id: 'beta', log }));

    await manager.activateAll();

    assert.deepEqual(log, ['activate:alpha', 'activate:beta']);
    assert.equal(manager.getPlugin('alpha')?.state, 'active');
    assert.equal(manager.getPlugin('beta')?.state, 'active');
    assert.equal(
      Number.isNaN(Date.parse(manager.getPlugin('alpha')?.activatedAt ?? '')),
      false,
    );
  });

  it('activates dependents in strict topological order', async () => {
    const log: string[] = [];
    const manager = createManager();

    manager.register(createPlugin({ id: 'gamma', dependencies: ['beta'], log }));
    manager.register(createPlugin({ id: 'beta', dependencies: ['alpha'], log }));
    manager.register(createPlugin({ id: 'alpha', log }));

    assert.deepEqual(manager.resolveActivationOrder(), ['alpha', 'beta', 'gamma']);

    await manager.activateAll();

    assert.deepEqual(log, ['activate:alpha', 'activate:beta', 'activate:gamma']);
    assert.equal(manager.getPlugin('alpha')?.state, 'active');
    assert.equal(manager.getPlugin('beta')?.state, 'active');
    assert.equal(manager.getPlugin('gamma')?.state, 'active');
  });

  it('rolls back every plugin activated in a failed pass in reverse order', async () => {
    const log: string[] = [];
    const failure = new Error('gamma activation failed');
    const manager = createManager();

    manager.register(createSubscriptionPlugin({ id: 'alpha', log }));
    manager.register(
      createSubscriptionPlugin({ id: 'beta', dependencies: ['alpha'], log }),
    );
    manager.register(
      createSubscriptionPlugin({
        id: 'gamma',
        dependencies: ['beta'],
        log,
        activationError: failure,
      }),
    );

    await assert.rejects(
      manager.activateAll(),
      (error: unknown) => {
        assert.ok(error instanceof PluginLifecycleError);
        assert.equal(error.code, 'PLUGIN_LIFECYCLE');
        assert.equal(error.phase, 'activate');
        assert.equal(error.pluginId, 'gamma');
        assert.equal(error.cause, failure);
        return true;
      },
    );

    assert.deepEqual(log, [
      'activate:alpha',
      'activate:beta',
      'activate:gamma',
      'dispose:gamma',
      'deactivate:beta',
      'dispose:beta',
      'deactivate:alpha',
      'dispose:alpha',
    ]);
    assert.equal(manager.getPlugin('alpha')?.state, 'unloaded');
    assert.equal(manager.getPlugin('beta')?.state, 'unloaded');

    const failed = manager.getPlugin('gamma');
    assert.ok(failed !== undefined);
    assert.equal(failed.state, 'failed');
    assert.match(failed.error ?? '', /gamma activation failed/);
  });
});

describe('PluginManagerService dynamic lifecycle', () => {
  it('recursively activates inactive dependencies', async () => {
    const log: string[] = [];
    const manager = createManager();

    manager.register(createPlugin({ id: 'beta', dependencies: ['alpha'], log }));
    manager.register(createPlugin({ id: 'alpha', log }));

    await manager.activatePlugin('beta');

    assert.deepEqual(log, ['activate:alpha', 'activate:beta']);
    assert.equal(manager.getPlugin('alpha')?.state, 'active');
    assert.equal(manager.getPlugin('beta')?.state, 'active');
  });

  it('rejects deactivation while an active dependent exists', async () => {
    const manager = createManager();

    manager.register(createPlugin({ id: 'beta', dependencies: ['alpha'] }));
    manager.register(createPlugin({ id: 'alpha' }));

    await manager.activatePlugin('beta');

    await assert.rejects(
      manager.deactivatePlugin('alpha'),
      (error: unknown) => {
        assert.ok(error instanceof PluginActiveDependencyError);
        assert.equal(error.code, 'PLUGIN_DEPENDENCY');
        assert.equal(error.pluginId, 'alpha');
        assert.deepEqual(error.dependentPluginIds, ['beta']);
        return true;
      },
    );

    assert.equal(manager.getPlugin('alpha')?.state, 'active');
    assert.equal(manager.getPlugin('beta')?.state, 'active');
  });

  it('deactivates a plugin and disposes its subscriptions when no dependent exists', async () => {
    const log: string[] = [];
    const manager = createManager();

    manager.register(createSubscriptionPlugin({ id: 'alpha', log }));

    await manager.activatePlugin('alpha');
    await manager.deactivatePlugin('alpha');

    assert.deepEqual(log, ['activate:alpha', 'deactivate:alpha', 'dispose:alpha']);

    const record = manager.getPlugin('alpha');
    assert.ok(record !== undefined);
    assert.equal(record.state, 'unloaded');
    assert.equal(record.activatedAt, undefined);
  });

  it('prevents unregistering a plugin that has active dependents', async () => {
    const manager = createManager();

    manager.register(createPlugin({ id: 'beta', dependencies: ['alpha'] }));
    manager.register(createPlugin({ id: 'alpha' }));

    await manager.activatePlugin('beta');

    await assert.rejects(
      manager.unregister('alpha'),
      (error: unknown) => {
        assert.ok(error instanceof PluginActiveDependencyError);
        assert.deepEqual(error.dependentPluginIds, ['beta']);
        return true;
      },
    );

    assert.ok(manager.getPlugin('alpha') !== undefined);
  });
});

describe('PluginManagerService teardown and capabilities', () => {
  it('continues batch deactivation after an individual teardown throws', async () => {
    const log: string[] = [];
    const failure = new Error('beta teardown failed');
    const manager = createManager();

    manager.register(createSubscriptionPlugin({ id: 'alpha', log }));
    manager.register(
      createSubscriptionPlugin({ id: 'beta', log, deactivationError: failure }),
    );

    await manager.activateAll();
    log.length = 0;

    await assert.rejects(
      manager.deactivateAll(),
      (error: unknown) => {
        assert.ok(error instanceof PluginLifecycleError);
        assert.equal(error.phase, 'deactivate');
        assert.equal(error.pluginId, 'beta');
        assert.equal(error.cause, failure);
        return true;
      },
    );

    assert.deepEqual(log, [
      'deactivate:beta',
      'dispose:beta',
      'deactivate:alpha',
      'dispose:alpha',
    ]);
    assert.equal(manager.getPlugin('alpha')?.state, 'unloaded');
    assert.equal(manager.getPlugin('beta')?.state, 'unloaded');
  });

  it('projects a read-only filesystem for plugins without fs:write', async () => {
    const fileSystem = new RecordingFileSystem();
    const manager = createManager(fileSystem);

    manager.register(
      createPlugin({
        id: 'reader',
        permissions: ['fs:read'],
        onActivate: async (context: IPluginContext): Promise<void> => {
          const scoped = context.getFileSystem();

          assert.notEqual(scoped, fileSystem);
          await assert.rejects(
            scoped.writeAtomic('notes.txt', 'data'),
            ReadOnlyViolationError,
          );
        },
      }),
    );

    await manager.activatePlugin('reader');

    assert.equal(manager.getPlugin('reader')?.state, 'active');
    assert.deepEqual(fileSystem.writes, []);
  });

  it('denies capability handles that were not declared', async () => {
    let denied: unknown;
    const manager = createManager();

    manager.register(
      createPlugin({
        id: 'restricted',
        onActivate: (context: IPluginContext): void => {
          try {
            context.getFileSystem();
          } catch (error: unknown) {
            denied = error;
          }
        },
      }),
    );

    await manager.activatePlugin('restricted');

    assert.ok(denied instanceof PluginPermissionError);
    assert.equal(denied.code, 'PLUGIN_PERMISSION');
    assert.equal(denied.pluginId, 'restricted');
  });
});
