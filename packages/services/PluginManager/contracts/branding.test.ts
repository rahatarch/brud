import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  certifyOfficialPlugin,
  hasOfficialPluginBrand,
  isReservedPluginId,
  RESERVED_PLUGIN_ID_PREFIXES,
} from './branding.js';

describe('official plugin branding', () => {
  it('certifies a first-party plugin with an own, hidden brand', () => {
    const plugin = { activate: (): void => undefined };
    const certified = certifyOfficialPlugin(plugin);

    assert.equal(certified, plugin);
    assert.equal(hasOfficialPluginBrand(certified), true);

    const [brandKey] = Object.getOwnPropertySymbols(certified);

    assert.ok(brandKey !== undefined);
    assert.equal(Object.getOwnPropertyDescriptor(certified, brandKey)?.enumerable, false);
  });

  it('is idempotent for an already certified plugin', () => {
    const certified = certifyOfficialPlugin({});
    const again = certifyOfficialPlugin(certified);

    assert.equal(again, certified);
    assert.equal(hasOfficialPluginBrand(again), true);
  });

  it('rejects unbranded and lookalike candidates', () => {
    const stringLookalike = {
      'brud.kernel.plugin.official': true,
      official: true,
      brand: 'brud',
    };
    const symbolLookalike = { [Symbol('brud.kernel.plugin.official')]: true };

    assert.equal(hasOfficialPluginBrand({}), false);
    assert.equal(hasOfficialPluginBrand(null), false);
    assert.equal(hasOfficialPluginBrand(undefined), false);
    assert.equal(hasOfficialPluginBrand('brud'), false);
    assert.equal(hasOfficialPluginBrand(stringLookalike), false);
    assert.equal(hasOfficialPluginBrand(symbolLookalike), false);
  });

  it('only reserves first-party identifier prefixes', () => {
    assert.deepEqual(RESERVED_PLUGIN_ID_PREFIXES, ['brud.', '@brud/']);
    assert.equal(isReservedPluginId('brud.tools.core'), true);
    assert.equal(isReservedPluginId('brud.'), true);
    assert.equal(isReservedPluginId('@brud/tools-core'), true);
    assert.equal(isReservedPluginId('brud-tools-core'), false);
    assert.equal(isReservedPluginId('acme.brud.tools'), false);
    assert.equal(isReservedPluginId('brud'), false);
  });
});
