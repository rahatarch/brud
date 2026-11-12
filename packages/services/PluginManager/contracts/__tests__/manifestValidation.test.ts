import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePluginManifest } from '../manifest.js';
import { isPluginPermission } from '../permissions.js';

const validManifest = {
  id: 'acme.tools.core',
  name: 'Core Tools',
  version: '2.3.1',
  permissions: ['tools:register', 'tools:execute'],
} as const;

describe('manifest validation contract', () => {
  it('validates a manifest carrying permissions and dependencies', () => {
    const result = validatePluginManifest({
      ...validManifest,
      description: 'Core tool registrations',
      dependencies: ['acme.core.filesystem', 'acme.core.history'],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.manifest.id, 'acme.tools.core');
    assert.equal(result.manifest.version, '2.3.1');
    assert.deepEqual(result.manifest.dependencies, [
      'acme.core.filesystem',
      'acme.core.history',
    ]);
    assert.deepEqual(result.manifest.permissions, ['tools:register', 'tools:execute']);
  });

  it('rejects a manifest without an id', () => {
    const result = validatePluginManifest({
      name: 'Core Tools',
      version: '1.0.0',
      permissions: [],
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.match(result.error, /manifest\.id/);
  });

  it('rejects a malformed semantic version', () => {
    const result = validatePluginManifest({ ...validManifest, version: '2.3' });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.match(result.error, /manifest\.version/);
  });

  it('accepts extensible permissions and rejects malformed tokens', () => {
    const flexible = validatePluginManifest({
      ...validManifest,
      permissions: ['fs:read', 'fs:destroy', 'photoshop:access'],
    });

    assert.equal(flexible.ok, true);

    const malformed = validatePluginManifest({
      ...validManifest,
      permissions: ['fs:read', 'FS:DESTROY'],
    });

    assert.equal(malformed.ok, false);
    if (malformed.ok) {
      return;
    }

    assert.match(malformed.error, /invalid capability token/);
  });

  it('rejects non-array dependencies', () => {
    const result = validatePluginManifest({
      ...validManifest,
      dependencies: { id: 'acme.core.filesystem' },
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.match(result.error, /manifest\.dependencies must be an array/);
  });

  it('never mutates its input', () => {
    const input = {
      ...validManifest,
      permissions: ['fs:read', 'fs:write'],
      dependencies: ['acme.core.filesystem'],
    };
    const snapshot = structuredClone(input);

    validatePluginManifest(input);

    assert.deepEqual(input, snapshot);
  });

  it('keeps the permission type guard deterministic', () => {
    for (const permission of validManifest.permissions) {
      const outcomes = [isPluginPermission(permission), isPluginPermission(permission)];

      assert.deepEqual(outcomes, [true, true]);
    }

    const invalid = 'FS:DELETE';

    assert.deepEqual([isPluginPermission(invalid), isPluginPermission(invalid)], [false, false]);
  });
});
