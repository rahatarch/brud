import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bootTestKernel } from '@brud/sdk/testing';
import { ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;

/** Runs `use` as a host session holding `capabilities`, with the vault handle (or null). */
function asHost(kernel, capabilities, use) {
  return kernel.runHostCall({ capabilities }, () => {
    const registry = kernel.requestAccess({ callerId: 'test.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    return use(registry.resolve('acme.vault'));
  });
}

test('a caller gets only the surface its capabilities earn', async (t) => {
  const kernel = await bootTestKernel(t, [{ path: join(here, 'vault.mjs') }]);

  assert.equal(asHost(kernel, [], (vault) => vault), null);
  assert.deepEqual(asHost(kernel, ['vault:read'], (vault) => Object.keys(vault)), ['read']);
  assert.equal(asHost(kernel, ['vault:read', 'vault:write'], (vault) => {
    vault.write('new');
    return vault.read();
  }), 'new');
});
