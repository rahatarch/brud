import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePluginManifest } from '../contracts/manifest.js';

const BASE_MANIFEST = {
  id: 'akkhar-labs.plugin.mcp-bridge',
  name: 'MCP Bridge',
  version: '0.0.1',
  permissions: ['tools:register', 'tools:execute'],
};

describe('plugin manifest transports', () => {
  it('accepts and copies declared transports', () => {
    const transports: ('stdio' | 'mcp-http')[] = ['stdio', 'mcp-http'];
    const result = validatePluginManifest({
      ...BASE_MANIFEST,
      transports,
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.deepEqual(result.manifest.transports, ['stdio', 'mcp-http']);

    transports.push('stdio');
    assert.deepEqual(result.manifest.transports, ['stdio', 'mcp-http']);
  });

  it('accepts a manifest without transports', () => {
    const result = validatePluginManifest(BASE_MANIFEST);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal('transports' in result.manifest, false);
  });

  it('accepts an empty transports array', () => {
    const result = validatePluginManifest({
      ...BASE_MANIFEST,
      transports: [],
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.deepEqual(result.manifest.transports, []);
  });

  it('rejects malformed transports', () => {
    for (const transports of [
      'stdio',
      [1],
      ['websocket'],
      ['stdio', 'stdio'],
      [null],
    ]) {
      const result = validatePluginManifest({
        ...BASE_MANIFEST,
        transports,
      });

      assert.equal(result.ok, false, `expected ${JSON.stringify(transports)} to be rejected`);
      if (!result.ok) {
        assert.match(result.error, /manifest\.transports/u);
      }
    }
  });
});