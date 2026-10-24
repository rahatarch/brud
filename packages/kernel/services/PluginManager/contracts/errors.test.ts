import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PluginDependencyError,
  PluginDuplicateError,
  PluginError,
  PluginLifecycleError,
  PluginNotFoundError,
  PluginPermissionError,
} from './errors.js';

describe('plugin errors', () => {
  it('exposes stable codes and plugin identifiers', () => {
    const notFound = new PluginNotFoundError('brud.tools.core');
    const duplicate = new PluginDuplicateError('brud.tools.core');

    assert.ok(notFound instanceof PluginError);
    assert.ok(duplicate instanceof PluginError);
    assert.equal(notFound.code, 'PLUGIN_NOT_FOUND');
    assert.equal(duplicate.code, 'PLUGIN_DUPLICATE');
    assert.equal(notFound.pluginId, 'brud.tools.core');
    assert.equal(duplicate.pluginId, 'brud.tools.core');
    assert.match(notFound.message, /is not registered/);
    assert.match(duplicate.message, /is already registered/);
  });

  it('describes a missing dependency', () => {
    const error = new PluginDependencyError({
      pluginId: 'brud.tools.core',
      dependencyId: 'brud.tools.shared',
    });

    assert.equal(error.code, 'PLUGIN_DEPENDENCY');
    assert.equal(error.dependencyId, 'brud.tools.shared');
    assert.equal(error.cyclePath, undefined);
    assert.match(error.message, /depends on unregistered plugin/);
  });

  it('describes a dependency cycle with an ordered path', () => {
    const path = ['a', 'b', 'a'];
    const error = new PluginDependencyError({ pluginId: 'a', cyclePath: path });

    path.push('a');

    assert.equal(error.code, 'PLUGIN_DEPENDENCY');
    assert.deepEqual(error.cyclePath, ['a', 'b', 'a']);
    assert.match(error.message, /a -> b -> a/);
  });

  it('lists the permissions that would authorize a capability', () => {
    const error = new PluginPermissionError('brud.tools.core', 'getFileSystem', [
      'fs:read',
      'fs:write',
    ]);

    assert.equal(error.code, 'PLUGIN_PERMISSION');
    assert.equal(error.pluginId, 'brud.tools.core');
    assert.equal(error.operation, 'getFileSystem');
    assert.deepEqual(error.requiredPermissions, ['fs:read', 'fs:write']);
    assert.match(error.message, /"fs:read", "fs:write"/);
  });

  it('preserves the failure cause of a lifecycle error', () => {
    const cause = new Error('boom');
    const error = new PluginLifecycleError('brud.tools.core', 'activate', cause);

    assert.equal(error.code, 'PLUGIN_LIFECYCLE');
    assert.equal(error.phase, 'activate');
    assert.equal(error.cause, cause);
    assert.match(error.message, /failed to activate: boom/);
  });

  it('handles a lifecycle failure without a cause', () => {
    const error = new PluginLifecycleError('brud.tools.core', 'deactivate');

    assert.equal(error.cause, undefined);
    assert.match(error.message, /failed to deactivate$/);
  });
});
