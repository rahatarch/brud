import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { certifyOfficialPlugin } from '../branding.js';
import { validatePluginManifest } from '../manifest.js';

const baseManifest = {
  id: 'acme.tools.core',
  name: 'Acme Tools',
  version: '1.0.0',
  permissions: [],
} as const;

describe('manifest authorization', () => {
  it('rejects an unverified reserved identifier', () => {
    const result = validatePluginManifest({ ...baseManifest, id: 'brud.tools.core' });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.reason, 'RESERVED_NAMESPACE');
    assert.match(result.error, /reserved official namespace/);
  });

  it('rejects an unverified scoped reserved identifier', () => {
    const result = validatePluginManifest({ ...baseManifest, id: '@brud/tools.core' });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.reason, 'RESERVED_NAMESPACE');
  });

  it('rejects an official claim without a genuine brand', () => {
    const result = validatePluginManifest({ ...baseManifest, official: true });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.reason, 'OFFICIAL_STATUS');
    assert.match(result.error, /official plugin branding/);
  });

  it('rejects a forged brand lookalike', () => {
    const forgedHolder = {
      'brud.kernel.plugin.official': true,
      official: true,
    };

    const result = validatePluginManifest(
      { ...baseManifest, official: true },
      { officialBrandHolder: forgedHolder },
    );

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.reason, 'OFFICIAL_STATUS');
  });

  it('accepts a certified plugin claiming official status', () => {
    const holder = certifyOfficialPlugin({});
    const result = validatePluginManifest(
      { ...baseManifest, official: true },
      { officialBrandHolder: holder },
    );

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.manifest.official, true);
    assert.equal(result.manifest.id, 'acme.tools.core');
  });

  it('accepts a certified plugin using a reserved namespace', () => {
    const holder = certifyOfficialPlugin({});
    const result = validatePluginManifest(
      { ...baseManifest, id: 'brud.tools.core' },
      { officialBrandHolder: holder },
    );

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.manifest.id, 'brud.tools.core');
    assert.equal('official' in result.manifest, false);
  });

  it('rejects a non-boolean official indicator', () => {
    const result = validatePluginManifest(
      { ...baseManifest, official: 'yes' },
      { officialBrandHolder: certifyOfficialPlugin({}) },
    );

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.reason, 'INVALID_MANIFEST');
    assert.match(result.error, /manifest\.official/);
  });

  it('leaves ordinary third-party manifests untouched', () => {
    const result = validatePluginManifest({ ...baseManifest, official: false });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.manifest.official, false);
    assert.equal(result.manifest.id, 'acme.tools.core');
  });
});
