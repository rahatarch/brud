import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_PERMISSION_REQUIREMENTS,
  PLUGIN_PERMISSIONS,
  isPluginPermission,
} from './permissions.js';
import type { PluginCapability } from './permissions.js';

describe('isPluginPermission', () => {
  it('accepts every declared permission', () => {
    for (const permission of PLUGIN_PERMISSIONS) {
      assert.equal(isPluginPermission(permission), true, permission);
    }
  });

  it('accepts extensible capability tokens', () => {
    const accepted: readonly unknown[] = [
      'fs:delete',
      'history',
      'photoshop:access',
      'acme:feature:beta',
    ];

    for (const candidate of accepted) {
      assert.equal(isPluginPermission(candidate), true, String(candidate));
    }
  });

  it('rejects malformed capability tokens', () => {
    const rejected: readonly unknown[] = [
      'FS:READ',
      ' tools:register',
      '',
      'tools::register',
      'tools:',
      ':read',
      'tools register',
    ];

    for (const candidate of rejected) {
      assert.equal(isPluginPermission(candidate), false, String(candidate));
    }
  });

  it('rejects non-string values', () => {
    const rejected: readonly unknown[] = [undefined, null, 0, true, {}, [], ['fs:read']];

    for (const candidate of rejected) {
      assert.equal(isPluginPermission(candidate), false);
    }
  });

  it('is deterministic across repeated calls', () => {
    const samples: readonly unknown[] = ['fs:read', 'fs:write', 'unknown', 42, null];

    for (const sample of samples) {
      const first = isPluginPermission(sample);
      const second = isPluginPermission(sample);

      assert.equal(first, second);
    }
  });
});

describe('permission catalog', () => {
  it('lists each permission exactly once', () => {
    assert.equal(new Set(PLUGIN_PERMISSIONS).size, PLUGIN_PERMISSIONS.length);
  });

  it('requires at least one valid permission for every capability', () => {
    const capabilities: readonly PluginCapability[] = ['fileSystem', 'universalHistory', 'tools'];

    for (const capability of capabilities) {
      const required = CAPABILITY_PERMISSION_REQUIREMENTS[capability];

      assert.ok(required.length > 0, capability);

      for (const permission of required) {
        assert.equal(isPluginPermission(permission), true);
      }
    }
  });
});
