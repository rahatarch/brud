import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PluginManagerToken } from './tokens.js';

describe('PluginManagerToken', () => {
  it('identifies the plugin manager service', () => {
    assert.equal(PluginManagerToken.id, 'PluginManager');
    assert.equal(PluginManagerToken.description, 'Service "PluginManager"');
  });

  it('carries no runtime service reference', () => {
    assert.deepEqual(PluginManagerToken._brand, []);
  });
});
