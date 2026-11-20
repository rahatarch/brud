import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDeferredKernel } from '../bootstrap/bootKernelInternal.js';
import { ContextContractError } from '../contracts/contextContract.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

/** The kernel package's own composition: the seven hardcore services only. */
const KERNEL_CONFIG_PATH = fileURLToPath(new URL('../../brud.config.json', import.meta.url));

describe('kernel boot options purity', () => {
  it('fails at the contract boundary, not from a service, when booted with an empty bag', async () => {
    const kernel = createDeferredKernel(KERNEL_CONFIG_PATH, {});

    await assert.rejects(
      kernel.boot({ options: {} }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.name, 'ContextContractError');
        assert.equal(error.field, 'identity.registry.path');
        assert.match(error.service ?? '', /identityRegistry/u);
        assert.match(error.message, /identity\.registry\.path/u);
        assert.doesNotMatch(error.name, /BrudKernel|LifecycleStateError/u);
        return true;
      },
    );
  });

  it('boots the kernel composition when the hardcores\' own fields are in the bag', async () => {
    const kernel = createDeferredKernel(KERNEL_CONFIG_PATH, {});

    await kernel.boot({ options: { ...workspaceContextOptions(process.cwd()) } });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
    } finally {
      await kernel.shutdown();
    }
  });
});
