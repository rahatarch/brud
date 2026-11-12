import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActivationOrder, resolveDeactivationOrder } from './activationOrder.js';
import { PluginDependencyError, PluginDuplicateError } from './errors.js';
import type { IBrudPlugin } from './IBrudPlugin.js';
import type { PluginManifest } from './manifest.js';

function plugin(id: string, dependencies: readonly string[] = []): IBrudPlugin {
  const manifest: PluginManifest = {
    id,
    name: id,
    version: '1.0.0',
    permissions: [],
    dependencies,
  };

  return {
    manifest,
    activate: (): void => undefined,
  };
}

describe('resolveActivationOrder', () => {
  it('places dependencies before dependents regardless of registration order', () => {
    const order = resolveActivationOrder([
      plugin('c', ['b']),
      plugin('b', ['a']),
      plugin('a'),
    ]);

    assert.deepEqual(order, ['a', 'b', 'c']);
  });

  it('orders diamond dependencies with the shared prerequisite first', () => {
    const order = resolveActivationOrder([
      plugin('a', ['b', 'c']),
      plugin('b', ['d']),
      plugin('c', ['d']),
      plugin('d'),
    ]);

    assert.deepEqual(order, ['d', 'b', 'c', 'a']);
  });

  it('breaks ties by registration order', () => {
    assert.deepEqual(resolveActivationOrder([plugin('z'), plugin('a')]), ['z', 'a']);
  });

  it('returns an empty order when nothing is registered', () => {
    assert.deepEqual(resolveActivationOrder([]), []);
  });

  it('rejects duplicate identifiers', () => {
    assert.throws(
      () => resolveActivationOrder([plugin('a'), plugin('a')]),
      (error: unknown) => {
        assert.ok(error instanceof PluginDuplicateError);
        assert.equal(error.pluginId, 'a');
        return true;
      },
    );
  });

  it('rejects missing dependencies', () => {
    assert.throws(
      () => resolveActivationOrder([plugin('dependent', ['missing'])]),
      (error: unknown) => {
        assert.ok(error instanceof PluginDependencyError);
        assert.equal(error.pluginId, 'dependent');
        assert.equal(error.dependencyId, 'missing');
        assert.equal(error.cyclePath, undefined);
        return true;
      },
    );
  });

  it('rejects self-referential cycles with the exact path', () => {
    assert.throws(
      () => resolveActivationOrder([plugin('self', ['self'])]),
      (error: unknown) => {
        assert.ok(error instanceof PluginDependencyError);
        assert.deepEqual(error.cyclePath, ['self', 'self']);
        return true;
      },
    );
  });

  it('rejects multi-plugin cycles with the exact path', () => {
    assert.throws(
      () => resolveActivationOrder([
        plugin('a', ['b']),
        plugin('b', ['c']),
        plugin('c', ['a']),
      ]),
      (error: unknown) => {
        assert.ok(error instanceof PluginDependencyError);
        assert.deepEqual(error.cyclePath, ['a', 'b', 'c', 'a']);
        return true;
      },
    );
  });

  it('does not mutate the registered plugin list', () => {
    const plugins = [plugin('b', ['a']), plugin('a')];
    const snapshot = plugins.map((entry) => entry.manifest.id);

    resolveActivationOrder(plugins);

    assert.deepEqual(plugins.map((entry) => entry.manifest.id), snapshot);
  });
});

describe('resolveDeactivationOrder', () => {
  it('returns the exact reverse of activation', () => {
    const activation = resolveActivationOrder([
      plugin('c', ['b']),
      plugin('b', ['a']),
      plugin('a'),
    ]);

    assert.deepEqual(resolveDeactivationOrder(activation), ['c', 'b', 'a']);
    assert.deepEqual(activation, ['a', 'b', 'c']);
  });

  it('returns an empty order for an empty activation order', () => {
    assert.deepEqual(resolveDeactivationOrder([]), []);
  });
});
