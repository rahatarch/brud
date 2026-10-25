import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLUGIN_ID_PATTERN,
  SEMVER_PATTERN,
  validatePluginManifest,
} from './manifest.js';

function errorOf(candidate: unknown): string {
  const result = validatePluginManifest(candidate);

  assert.equal(result.ok, false);
  if (result.ok) {
    return '';
  }

  return result.error;
}

describe('validatePluginManifest', () => {
  it('accepts a reverse-DNS identifier with permissions and dependencies', () => {
    const result = validatePluginManifest({
      id: 'acme.tools.core',
      name: 'Core Tools',
      version: '1.4.0',
      description: 'Registers the core tool set',
      dependencies: ['acme.tools.shared'],
      permissions: ['tools:register', 'tools:execute'],
    });

    assert.deepEqual(result, {
      ok: true,
      manifest: {
        id: 'acme.tools.core',
        name: 'Core Tools',
        version: '1.4.0',
        description: 'Registers the core tool set',
        dependencies: ['acme.tools.shared'],
        permissions: ['tools:register', 'tools:execute'],
      },
    });
  });

  it('accepts a kebab-case identifier with an empty permission list', () => {
    const result = validatePluginManifest({
      id: 'brud-tools-core',
      name: 'Core Tools',
      version: '0.0.1-beta.2+build.7',
      permissions: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.manifest.id, 'brud-tools-core');
    assert.deepEqual(result.manifest.permissions, []);
    assert.equal('dependencies' in result.manifest, false);
    assert.equal('description' in result.manifest, false);
  });

  it('returns a defensive copy of manifest arrays', () => {
    const dependencies = ['acme.tools.shared'];
    const permissions: ('fs:read' | 'fs:write')[] = ['fs:read'];

    const result = validatePluginManifest({
      id: 'acme.tools.core',
      name: 'Core Tools',
      version: '1.0.0',
      dependencies,
      permissions,
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    dependencies.push('acme.tools.extra');
    permissions.push('fs:write');

    assert.deepEqual(result.manifest.dependencies, ['acme.tools.shared']);
    assert.deepEqual(result.manifest.permissions, ['fs:read']);
  });

  it('rejects non-object candidates', () => {
    for (const candidate of [null, undefined, 1, 'manifest', [], true]) {
      assert.equal(validatePluginManifest(candidate).ok, false);
    }
  });

  it('rejects a missing or malformed id', () => {
    assert.match(errorOf({ name: 'X', version: '1.0.0', permissions: [] }), /manifest\.id/);
    assert.match(
      errorOf({ id: 'Brud.Tools', name: 'X', version: '1.0.0', permissions: [] }),
      /manifest\.id/,
    );
    assert.match(
      errorOf({ id: 'acme..tools', name: 'X', version: '1.0.0', permissions: [] }),
      /manifest\.id/,
    );
    assert.match(
      errorOf({ id: 42, name: 'X', version: '1.0.0', permissions: [] }),
      /manifest\.id/,
    );
  });

  it('rejects a missing or blank name', () => {
    assert.match(errorOf({ id: 'acme.tools', version: '1.0.0', permissions: [] }), /manifest\.name/);
    assert.match(
      errorOf({ id: 'acme.tools', name: '   ', version: '1.0.0', permissions: [] }),
      /manifest\.name/,
    );
  });

  it('rejects malformed semantic versions', () => {
    const versions = ['1.0', 'v1.0.0', '1.0.0.0', '01.0.0', '1.0.0-', 'latest'];

    for (const version of versions) {
      assert.match(
        errorOf({ id: 'acme.tools', name: 'Tools', version, permissions: [] }),
        /manifest\.version/,
        version,
      );
    }
  });

  it('rejects unknown and duplicate permissions', () => {
    assert.match(
      errorOf({
        id: 'acme.tools',
        name: 'Tools',
        version: '1.0.0',
        permissions: ['fs:delete'],
      }),
      /unknown permission/,
    );

    assert.match(
      errorOf({
        id: 'acme.tools',
        name: 'Tools',
        version: '1.0.0',
        permissions: ['fs:read', 'fs:read'],
      }),
      /duplicate permission/,
    );

    assert.match(
      errorOf({ id: 'acme.tools', name: 'Tools', version: '1.0.0' }),
      /manifest\.permissions is required/,
    );
  });

  it('rejects non-array dependencies', () => {
    assert.match(
      errorOf({
        id: 'acme.tools',
        name: 'Tools',
        version: '1.0.0',
        permissions: [],
        dependencies: 'acme.tools.shared',
      }),
      /manifest\.dependencies must be an array/,
    );
  });

  it('rejects malformed, duplicate, and self-referential dependencies', () => {
    assert.match(
      errorOf({
        id: 'acme.tools',
        name: 'Tools',
        version: '1.0.0',
        permissions: [],
        dependencies: ['Acme.Tools.Shared'],
      }),
      /manifest\.dependencies/,
    );

    assert.match(
      errorOf({
        id: 'acme.tools',
        name: 'Tools',
        version: '1.0.0',
        permissions: [],
        dependencies: ['acme.shared', 'acme.shared'],
      }),
      /duplicate plugin identifier/,
    );

    assert.match(
      errorOf({
        id: 'acme.tools',
        name: 'Tools',
        version: '1.0.0',
        permissions: [],
        dependencies: ['acme.tools'],
      }),
      /must not include the plugin itself/,
    );
  });

  it('reports the first error deterministically', () => {
    const invalid = {
      id: 'Brud.Tools',
      name: '',
      version: 'latest',
      permissions: ['fs:delete'],
    };

    assert.equal(errorOf(invalid), errorOf({ ...invalid }));
    assert.match(errorOf(invalid), /manifest\.id/);
  });

  it('exposes stable identifier and semver patterns', () => {
    assert.equal(PLUGIN_ID_PATTERN.test('acme.tools.core'), true);
    assert.equal(PLUGIN_ID_PATTERN.test('brud-tools-core'), true);
    assert.equal(PLUGIN_ID_PATTERN.test('brud_tools'), false);
    assert.equal(SEMVER_PATTERN.test('1.0.0'), true);
    assert.equal(SEMVER_PATTERN.test('1.0'), false);
  });
});
