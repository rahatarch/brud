import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bootTestKernel } from '@brud/sdk/testing';
import { ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;

test('one participant uses another through its exposure', async (t) => {
  const kernel = await bootTestKernel(t, [{ path: join(here, 'greeter.mjs') }, { path: join(here, 'shout.mjs') }]);
  const out = kernel.runHostCall({ capabilities: [] }, () => {
    const registry = kernel.requestAccess({ callerId: 'test.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    return registry.resolve('acme.shout').shout('ada');
  });

  assert.equal(out, 'HELLO, ADA (ASKED BY PARTICIPANT)');
});
