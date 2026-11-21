import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bootTestKernel } from '@brud/sdk/testing';
import { ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;

test('the note kind routes add and list', async (t) => {
  const kernel = await bootTestKernel(t, [{ path: join(here, 'notes.mjs') }]);
  const routed = await kernel.runHostCall({ capabilities: [] }, async () => {
    const registry = kernel.requestAccess({ callerId: 'test.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    return registry.resolve('syntax.route').route('[BRUD]\n[CALL note add]\ntext: hi\n[END]\n[CALL note list]\n[END]\n[/BRUD]');
  });

  assert.equal(routed.status, 'success');
  assert.deepEqual(routed.operations.at(-1).result.data.notes, ['hi']);
});
