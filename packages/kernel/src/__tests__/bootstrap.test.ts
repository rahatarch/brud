import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../drivers/memory/index.js';
import { FileSystemToken } from '../../services/BrudFileSystem/descriptor/tokens.js';
import { createStandardKernel } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { BrudKernel } from '../engine/BrudKernel.js';
import { LifecycleStateError } from '../engine/errors.js';

const WORKSPACE_ROOT = '/workspace';

function createCaller(overrides?: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'test.runner',
    tier: 'core',
    workspaceRoot: WORKSPACE_ROOT,
    ...overrides,
  };
}

async function bootStandardKernel(driver: InMemoryStorageDriver): Promise<BrudKernel> {
  const kernel = createStandardKernel({ storageDriver: driver });
  await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });
  return kernel;
}

describe('createStandardKernel', () => {
  it('boots the kernel and resolves the file system service', async () => {
    const kernel = createStandardKernel({ storageDriver: new InMemoryStorageDriver() });

    assert.equal(kernel.lifecycleState, 'UNINITIALIZED');
    assert.equal(kernel.hasService(FileSystemToken), true);

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(kernel.hasService(FileSystemToken), true);

    await kernel.shutdown();
  });

  it('mediates file system access through the access broker', async () => {
    const kernel = await bootStandardKernel(new InMemoryStorageDriver());

    try {
      const fs = kernel.requestAccess(createCaller(), FileSystemToken);

      await fs.writeAtomic('sample.txt', 'hello world');

      assert.equal(await fs.readText('sample.txt'), 'hello world');
    } finally {
      await kernel.shutdown();
    }
  });

  it('scopes writes to the caller partition prefix', async () => {
    const driver = new InMemoryStorageDriver();
    const kernel = await bootStandardKernel(driver);

    try {
      const scopedFs = kernel.requestAccess(
        createCaller({ partitionPrefix: '.brud/history' }),
        FileSystemToken,
      );

      await scopedFs.writeAtomic('index.json', '{"version": 1}');

      assert.equal(
        await driver.readText(`${WORKSPACE_ROOT}/.brud/history/index.json`),
        '{"version": 1}',
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('rejects access after shutdown', async () => {
    const kernel = await bootStandardKernel(new InMemoryStorageDriver());

    await kernel.shutdown();

    assert.equal(kernel.lifecycleState, 'DISPOSED');
    assert.throws(
      () => kernel.requestAccess(createCaller(), FileSystemToken),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleStateError);
        assert.equal(error.code, 'INVALID_LIFECYCLE_STATE');
        assert.equal(error.currentState, 'DISPOSED');
        return true;
      },
    );
  });
});
