import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardKernel } from './support/standardKernel.js';
import { ContextContractError } from '../contracts/contextContract.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

describe('kernel boot options purity', () => {
  it('fails at the contract boundary, not from a service, when booted with an empty bag', async () => {
    const kernel = createStandardKernel();

    await assert.rejects(
      kernel.boot({ options: {} }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.name, 'ContextContractError');
        const field = error.field ?? '';

        assert.match(field, /\.root$/u);
        assert.equal(error.service, field.split('.')[0]);
        assert.equal(error.expectedType, 'string');
        assert.equal(error.actualType, 'missing');
        assert.match(error.message, /Required context field/u);
        assert.match(error.message, /Expected string/u);
        assert.doesNotMatch(error.name, /MissingWorkspaceRootError|BrudKernel|LifecycleStateError/u);
        return true;
      },
    );
  });

  it('boots the standard kernel when the workspace root is in the bag', async () => {
    const kernel = createStandardKernel({ history: { inMemory: true } });

    await kernel.boot({
      options: {...workspaceContextOptions(process.cwd()), history: { inMemory: true } },
    });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
    } finally {
      await kernel.shutdown();
    }
  });
});
