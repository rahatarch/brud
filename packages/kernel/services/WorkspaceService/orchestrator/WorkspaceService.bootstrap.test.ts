import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { BrudKernel } from '../../../src/engine/BrudKernel.js';
import type { BrudFileSystem } from '../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import { SettingsReaderToken, SettingsToken } from '../../SettingsService/descriptor/tokens.js';
import { createLegacyPathAdapter } from '../legacy/LegacyPathAdapter.js';
import { WorkspaceToken } from '../descriptor/tokens.js';

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly outside: string;
}

async function createFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-workspace-boot-')));
  const workspace = join(base, 'workspace');
  const outside = join(base, 'outside');

  await mkdir(join(workspace, 'notes'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(workspace, 'notes', 'draft.md'), '# draft\n', 'utf8');
  await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET', 'utf8');

  if (process.platform !== 'win32') {
    await symlink(outside, join(workspace, 'escape'), 'dir');
  }

  return { base, workspace, outside };
}

function caller(workspaceRoot: string, overrides?: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'brud.host.desktop',
    tier: 'core',
    workspaceRoot,
    ...overrides,
  };
}

describe('WorkspaceService boot integration', () => {
  it('registers between settings and the filesystem and canonicalizes the boot root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const kernel: BrudKernel = createStandardKernel({ history: { inMemory: true } });

    await kernel.boot({ workspaceRoot: fixture.workspace });

    try {
      const ids = kernel.listServices().map((service) => service.id);

      assert.equal(ids[0], 'brud.core.settings');
      assert.ok(ids.indexOf('brud.core.workspace') > ids.indexOf('brud.core.settings.reader'));
      assert.ok(ids.indexOf('brud.core.workspace') < ids.indexOf('brud.core.filesystem'));
      assert.equal(kernel.hasService(SettingsToken), true);
      assert.equal(kernel.hasService(SettingsReaderToken), true);
      assert.equal(kernel.hasService(FileSystemToken), true);

      const workspace = kernel.requestAccess(caller(fixture.workspace), WorkspaceToken);

      assert.equal(workspace.primaryRoot, await realpath(fixture.workspace));
      assert.equal((await workspace.toKernelPath(join(fixture.workspace, 'notes', 'draft.md'))), 'notes/draft.md');
      assert.equal(workspace.toAbsolutePath('notes/draft.md'), join(workspace.primaryRoot, 'notes', 'draft.md'));
      assert.equal(await workspace.contains(join(fixture.workspace, 'notes', 'draft.md')), true);
    } finally {
      await kernel.shutdown();
    }
  });

  it('binds the filesystem to the workspace service canonical root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    if (process.platform === 'win32') {
      return;
    }

    const linkedRoot = join(fixture.base, 'linked-root');
    await symlink(fixture.workspace, linkedRoot, 'dir');

    const kernel = createStandardKernel({ history: { inMemory: true } });

    await kernel.boot({ workspaceRoot: linkedRoot });

    try {
      const workspace = kernel.requestAccess(caller(linkedRoot), WorkspaceToken);
      const fileSystem = kernel.requestAccess(caller(linkedRoot), FileSystemToken) as unknown as BrudFileSystem;

      assert.equal(workspace.primaryRoot, await realpath(fixture.workspace));
      assert.equal(fileSystem.workspaceRoot, workspace.primaryRoot);
      assert.equal(
        fileSystem.workspaceRoot,
        await realpath(linkedRoot),
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('rejects symlink escapes through the kernel-resolved service', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    if (process.platform === 'win32') {
      return;
    }

    const kernel = createStandardKernel({ history: { inMemory: true } });

    await kernel.boot({ workspaceRoot: fixture.workspace });

    try {
      const workspace = kernel.requestAccess(caller(fixture.workspace), WorkspaceToken);

      await assert.rejects(
        workspace.resolve('escape/secret.txt'),
        (error: unknown) => error instanceof Error && 'rule' in error && error.rule === 'SYMLINK_ESCAPE',
      );
      assert.equal(await workspace.contains('escape/secret.txt'), false);
      assert.equal(await workspace.contains(join(fixture.outside, 'secret.txt')), false);
    } finally {
      await kernel.shutdown();
    }
  });

  it('serves legacy absolute paths through the adapter on a booted kernel', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const kernel = createStandardKernel({ history: { inMemory: true } });

    await kernel.boot({ workspaceRoot: fixture.workspace });

    try {
      const workspace = kernel.requestAccess(caller(fixture.workspace), WorkspaceToken);
      const adapter = createLegacyPathAdapter(workspace);
      const absoluteInside = join(fixture.workspace, 'notes', 'draft.md');

      assert.equal(await adapter.toKernelRelative(absoluteInside), 'notes/draft.md');
      assert.equal(adapter.toLegacyAbsolute('notes/draft.md'), join(await realpath(fixture.workspace), 'notes', 'draft.md'));

      const outside = await adapter.validate(join(fixture.outside, 'secret.txt'), 'read_file');

      assert.equal(outside.ok, false);
      assert.equal(outside.ok ? '' : outside.code, 'PATH_OUTSIDE_WORKSPACE');
    } finally {
      await kernel.shutdown();
    }
  });

  it('rejects a filesystem-root workspace at boot', async () => {
    const kernel = createStandardKernel({ history: { inMemory: true } });

    await assert.rejects(kernel.boot({ workspaceRoot: '/' }));
    assert.equal(kernel.lifecycleState, 'DISPOSED');
  });
});
