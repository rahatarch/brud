import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from '../kernelRuntime.js';

describe('daemon kernel composition', () => {
  it('boots from brud.config.json with the Brand Registry service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brud-daemon-brand-'));
    const kernel = await createKernel({ workspaceRoot: root });
    const kernelModule = await import('@brud/kernel');

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
      assert.equal(kernel.hasService(kernelModule.BrandRegistryToken), true);
    } finally {
      await kernel.shutdown().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});