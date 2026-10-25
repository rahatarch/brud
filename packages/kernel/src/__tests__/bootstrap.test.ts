import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../drivers/memory/index.js';
import { FileSystemToken } from '../../services/BrudFileSystem/descriptor/tokens.js';
import { PluginManagerToken } from '../../services/PluginManager/contracts/tokens.js';
import { UniversalHistoryToken } from '../../services/UniversalHistory/descriptor/tokens.js';
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
  const kernel = createStandardKernel({
    storageDriver: driver,
    history: { inMemory: true },
  });
  await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });
  return kernel;
}

describe('createStandardKernel', () => {
  it('boots the kernel and resolves the standard core services', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
    });

    assert.equal(kernel.lifecycleState, 'UNINITIALIZED');
    assert.equal(kernel.hasService(FileSystemToken), true);
    assert.equal(kernel.hasService(UniversalHistoryToken), true);
    assert.equal(kernel.hasService(PluginManagerToken), true);

    await kernel.boot({ workspaceRoot: WORKSPACE_ROOT });

    assert.equal(kernel.lifecycleState, 'RUNNING');
    assert.equal(kernel.hasService(FileSystemToken), true);
    assert.equal(kernel.hasService(UniversalHistoryToken), true);
    assert.equal(kernel.hasService(PluginManagerToken), true);

    await kernel.shutdown();
  });

  it('resolves the history service lazily after the kernel is RUNNING', async () => {
    const kernel = await bootStandardKernel(new InMemoryStorageDriver());

    try {
      const fileSystem = kernel.requestAccess(createCaller(), FileSystemToken);
      const history = kernel.requestAccess(createCaller(), UniversalHistoryToken);

      await fileSystem.writeAtomic('src/history.ts', 'export const value = 1;\n');

      const sessionId = await history.beginSession('bootstrap history', [
        'src/history.ts',
      ]);

      await fileSystem.writeAtomic('src/history.ts', 'export const value = 2;\n');

      const receipt = await history.commitSession(sessionId, 'completed');
      assert.equal(receipt.committedFileCount, 1);

      const manifest = await history.getSession(sessionId);
      assert.ok(manifest !== null);
      assert.equal(manifest.status, 'committed');
    } finally {
      await kernel.shutdown();
    }
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
        createCaller({ partitionPrefix: '.brud/work' }),
        FileSystemToken,
      );

      await scopedFs.writeAtomic('index.json', '{"version": 1}');

      assert.equal(
        await driver.readText(`${WORKSPACE_ROOT}/.brud/work/index.json`),
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
