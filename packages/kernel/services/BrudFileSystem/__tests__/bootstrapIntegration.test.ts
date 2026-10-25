import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import type { IWorkspaceService } from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import { createFileMutationJournal } from '../events/FileMutationJournal.js';
import type { FileMutationEvent } from '../events/types.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { FileSystemToken } from '../descriptor/tokens.js';
import { createFileSystemDescriptor } from '../descriptor/descriptor.js';

const ROOT = '/workspace';

function caller(): ServiceContext {
  return {
    callerId: 'brud.host.desktop',
    tier: 'core',
    workspaceRoot: ROOT,
  };
}

async function bootKernel(
  options?: { onEvent?: (event: FileMutationEvent) => void },
): Promise<{
  kernel: ReturnType<typeof createStandardKernel>;
  fileSystem: BrudFileSystem;
  workspace: IWorkspaceService;
}> {
  const journal = createFileMutationJournal();

  if (options?.onEvent !== undefined) {
    journal.subscribe(options.onEvent);
  }

  const kernel = createStandardKernel({
    storageDriver: new InMemoryStorageDriver(),
    history: { inMemory: true },
    mutationJournal: journal,
  });

  await kernel.boot({ workspaceRoot: ROOT });

  const workspace = kernel.requestAccess(caller(), WorkspaceToken);
  const fileSystem = kernel.requestAccess(caller(), FileSystemToken) as unknown as BrudFileSystem;

  return { kernel, fileSystem, workspace };
}

describe('BrudFileSystem descriptor and kernel bootstrap', () => {
  it('declares the workspace and settings reader dependencies', () => {
    const descriptor = createFileSystemDescriptor();

    assert.equal(descriptor.token, FileSystemToken);
    assert.equal(descriptor.tier, 'core');
    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      ['brud.core.workspace', 'brud.core.settings.reader'],
    );
  });

  it('injects the canonical workspace instance into the filesystem service', async () => {
    const { kernel, fileSystem, workspace } = await bootKernel();

    try {
      assert.equal(fileSystem.workspaceRoot, workspace.primaryRoot);
      assert.equal(kernel.hasService(WorkspaceToken), true);

      await fileSystem.writeAtomic('src/index.ts', 'export const value = 1;\n');

      assert.equal(await fileSystem.readText('src/index.ts'), 'export const value = 1;\n');
      assert.equal(await workspace.toKernelPath(`${ROOT}/src/index.ts`), 'src/index.ts');
    } finally {
      await kernel.shutdown();
    }
  });

  it('fails closed with a typed workspace error for out-of-bounds paths', async () => {
    const { kernel, fileSystem } = await bootKernel();

    try {
      await assert.rejects(fileSystem.readFile('../outside.txt'), (error: unknown) => {
        assert.ok(error instanceof WorkspaceViolationError);
        assert.equal(error.code, 'WORKSPACE_PATH_VIOLATION');
        assert.equal(error.rule, 'TRAVERSAL');

        return true;
      });
      await assert.rejects(
        fileSystem.writeAtomic(`${ROOT}-evil/secret.txt`, 'nope'),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceViolationError);
          assert.equal(error.rule, 'SIBLING_PREFIX');

          return true;
        },
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('publishes boot-wired mutation descriptors for Phase 4 history binding', async () => {
    const events: FileMutationEvent[] = [];
    const { kernel, fileSystem } = await bootKernel({
      onEvent: (event) => {
        events.push(event);
      },
    });

    try {
      assert.equal(fileSystem.mutationJournal.enabled, true);

      await fileSystem.writeAtomic('src/history.ts', 'export const value = 2;\n');
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      const writeEvents = events.filter((event) => event.operation === 'write');

      assert.equal(writeEvents.length, 2);
      assert.equal(writeEvents[0]?.path, 'src/history.ts');
      assert.equal(writeEvents[0]?.previous.exists, false);
      assert.equal(typeof writeEvents[1]?.updated.sha256, 'string');
    } finally {
      await kernel.shutdown();
    }
  });
});
