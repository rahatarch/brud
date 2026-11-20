import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from '../../../kernel/src/__tests__/support/standardKernel.js';
import type { ServiceContext } from '@brud/kernel';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import type { IWorkspaceService } from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import type { IFileMutationJournal } from '../events/types.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { FileSystemToken } from '../descriptor/tokens.js';
import { createFileSystemDescriptor } from '../descriptor/descriptor.js';
import { workspaceContextOptions } from '../../test-support/workspaceContext.js';

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-bootstrap-integration-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function caller(): ServiceContext {
  return {
    callerId: 'brud.host.desktop',
    tier: 'core',
    options: { 'filesystem.root': root },
  };
}

async function bootKernel(): Promise<{
  kernel: ReturnType<typeof createStandardKernel>;
  fileSystem: BrudFileSystem;
  workspace: IWorkspaceService;
  mutationJournal: IFileMutationJournal;
}> {
  const kernel = createStandardKernel({
    history: { inMemory: true },
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const workspace = kernel.requestAccess(caller(), WorkspaceToken);
  const raw = kernel.requestAccess(caller(), FileSystemToken) as unknown as BrudFileSystem;
  // Production mirror: a host reaches the filesystem inside a host call chain.
  const fileSystem = new Proxy(raw, {
    get: (target, property) => {
      const member = Reflect.get(target, property, target) as unknown;

      return typeof member === 'function'
        ? (...args: unknown[]) => kernel.runHostCall(
          { capabilities: ['workspace:read', 'validation:read'] },
          () => Reflect.apply(member, target, args),
        )
        : member;
    },
  });

  return {
    kernel,
    fileSystem,
    workspace,
    mutationJournal: fileSystem.mutationJournal,
  };
}

describe('BrudFileSystem descriptor and kernel bootstrap', () => {
  it('declares no token dependencies (givers are resolved through exposures)', () => {
    const descriptor = createFileSystemDescriptor();

    assert.equal(descriptor.token.id, FileSystemToken.id);
    assert.equal(descriptor.tier, 'core');
    assert.deepEqual(descriptor.dependencies, []);
  });

  it('injects the canonical workspace instance into the filesystem service', async () => {
    const { kernel, fileSystem, workspace } = await bootKernel();

    try {
      assert.equal(fileSystem.workspaceRoot, workspace.primaryRoot);
      assert.equal(kernel.hasService(WorkspaceToken), true);

      await fileSystem.writeAtomic('src/index.ts', 'export const value = 1;\n');

      assert.equal(await fileSystem.readText('src/index.ts'), 'export const value = 1;\n');
      assert.equal(await workspace.toKernelPath(`${root}/src/index.ts`), 'src/index.ts');
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
        fileSystem.writeAtomic(`${root}-evil/secret.txt`, 'nope'),
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
    const events: import('../events/types.js').FileMutationEvent[] = [];
    const { kernel, fileSystem, mutationJournal } = await bootKernel();

    mutationJournal.subscribe((event) => {
      events.push(event);
    });

    try {
      assert.equal(mutationJournal.enabled, true);

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
