import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActivationOrder } from './activationOrder.js';
import { PluginDuplicateError } from './errors.js';
import type { IBrudPlugin } from './IBrudPlugin.js';
import type {
  IPluginManagerService,
  PluginRecord,
  PluginState,
} from './IPluginManager.js';
import type { PluginManifest } from './manifest.js';

function plugin(id: string, dependencies: readonly string[] = []): IBrudPlugin {
  const manifest: PluginManifest = {
    id,
    name: id,
    version: '1.0.0',
    permissions: [],
    dependencies,
  };

  return { manifest, activate: (): void => undefined };
}

class RegistrationOnlyManager implements IPluginManagerService {
  private readonly records: PluginRecord[] = [];

  register(candidate: IBrudPlugin): void {
    if (this.records.some((record) => record.plugin.manifest.id === candidate.manifest.id)) {
      throw new PluginDuplicateError(candidate.manifest.id);
    }

    this.records.push({ plugin: candidate, state: 'unloaded' });
  }

  getPlugin(id: string): PluginRecord | undefined {
    return this.records.find((record) => record.plugin.manifest.id === id);
  }

  listPlugins(): readonly PluginRecord[] {
    return [...this.records];
  }

  async activateAll(): Promise<void> {
    await Promise.resolve();
  }

  async deactivateAll(): Promise<void> {
    await Promise.resolve();
  }

  resolveActivationOrder(): readonly string[] {
    return resolveActivationOrder(this.records.map((record) => record.plugin));
  }
}

describe('IPluginManagerService contract', () => {
  it('registers plugins as unloaded records in registration order', () => {
    const manager: IPluginManagerService = new RegistrationOnlyManager();

    manager.register(plugin('b', ['a']));
    manager.register(plugin('a'));

    assert.deepEqual(
      manager.listPlugins().map((record) => record.plugin.manifest.id),
      ['b', 'a'],
    );
    assert.equal(manager.getPlugin('a')?.state, 'unloaded');
    assert.equal(manager.getPlugin('missing'), undefined);
  });

  it('rejects duplicate registrations', () => {
    const manager = new RegistrationOnlyManager();
    manager.register(plugin('a'));

    assert.throws(() => manager.register(plugin('a')), PluginDuplicateError);
  });

  it('resolves activation order from registered dependencies', () => {
    const manager = new RegistrationOnlyManager();
    manager.register(plugin('c', ['b']));
    manager.register(plugin('b', ['a']));
    manager.register(plugin('a'));

    assert.deepEqual(manager.resolveActivationOrder(), ['a', 'b', 'c']);
  });

  it('represents every lifecycle state in a record', () => {
    const states: readonly PluginState[] = [
      'unloaded',
      'activating',
      'active',
      'deactivating',
      'failed',
    ];

    for (const state of states) {
      const record: PluginRecord = {
        plugin: plugin('a'),
        state,
        ...(state === 'active' ? { activatedAt: '2026-01-01T00:00:00.000Z' } : {}),
        ...(state === 'failed' ? { error: 'activation failed' } : {}),
      };

      assert.equal(record.state, state);
    }
  });
});
