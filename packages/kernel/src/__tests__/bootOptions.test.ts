import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardKernel } from '../bootstrap/index.js';
import { MissingWorkspaceRootError } from '../../services/WorkspaceService/bootOptions.js';

describe('kernel boot options purity', () => {
  it('fails from the Workspace Service, not the Core, when booted with an empty bag', async () => {
    const kernel = createStandardKernel();

    await assert.rejects(
      kernel.boot({ options: {} }),
      (error: unknown) => {
        assert.ok(error instanceof MissingWorkspaceRootError);
        assert.equal(error.name, 'MissingWorkspaceRootError');
        assert.match(error.message, /brud\.core\.workspace/u);
        assert.match(error.message, /options\.workspaceRoot/u);
        assert.doesNotMatch(error.name, /BrudKernel|LifecycleStateError/u);
        return true;
      },
    );
  });

  it('boots the standard kernel when the workspace root is in the bag', async () => {
    const kernel = createStandardKernel({ history: { inMemory: true } });

    await kernel.boot({
      options: { workspaceRoot: process.cwd(), history: { inMemory: true } },
    });

    try {
      assert.equal(kernel.lifecycleState, 'RUNNING');
    } finally {
      await kernel.shutdown();
    }
  });
});