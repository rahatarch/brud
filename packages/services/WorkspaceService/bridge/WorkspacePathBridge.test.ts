import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeStorageDriver } from '../../BrudFileSystem/drivers/index.js';
import { WorkspaceService } from '../orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import {
  WorkspacePathBridgeError,
  DefaultWorkspacePathBridge,
  createWorkspacePathBridge,
} from './WorkspacePathBridge.js';

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly outside: string;
  readonly sibling: string;
}

async function createFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-path-bridge-')));
  const workspace = join(base, 'workspace');
  const outside = join(base, 'outside');
  const sibling = join(base, 'workspace-evil');

  await mkdir(join(workspace, 'notes'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await mkdir(sibling, { recursive: true });
  await writeFile(join(workspace, 'notes', 'draft.md'), '# draft\n', 'utf8');
  await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET', 'utf8');
  await writeFile(join(sibling, 'secret.txt'), 'SIBLING-SECRET', 'utf8');
  await symlink(outside, join(workspace, 'escape'), 'dir');

  return { base, workspace, outside, sibling };
}

async function createAdapter(workspace: string): Promise<DefaultWorkspacePathBridge> {
  const service = new WorkspaceService({
    roots: [workspace],
    port: createStorageDriverPathPort(new NodeStorageDriver()),
    flavor: process.platform === 'win32' ? 'win32' : 'posix',
  });
  await service.initialize();

  return createWorkspacePathBridge(service);
}

describe('DefaultWorkspacePathBridge translation', () => {
  it('translates absolute and relative inputs to kernel-relative descriptors', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);

    assert.equal(await adapter.toKernelRelative('notes/draft.md'), 'notes/draft.md');
    assert.equal(await adapter.toKernelRelative(join(fixture.workspace, 'notes', 'draft.md')), 'notes/draft.md');
    assert.equal(await adapter.toKernelRelative(fixture.workspace), '');
    assert.equal(await adapter.toKernelRelative('./notes//draft.md'), 'notes/draft.md');
  });

  it('translates kernel descriptors back to canonical absolute paths', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);
    const canonicalRoot = await realpath(fixture.workspace);

    assert.equal(adapter.toHostAbsolute('notes/draft.md'), join(canonicalRoot, 'notes', 'draft.md'));
    assert.equal(adapter.toHostAbsolute(''), canonicalRoot);

    const roundTrip = adapter.toHostAbsolute(await adapter.toKernelRelative(join(fixture.workspace, 'notes', 'draft.md')));

    assert.equal(roundTrip, join(canonicalRoot, 'notes', 'draft.md'));
  });

  it('does not decode percent escapes', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);

    assert.equal(await adapter.toKernelRelative('%2e%2e/secret.txt'), '%2e%2e/secret.txt');
  });

  it('throws bridge-coded errors with the external field shape', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);

    await assert.rejects(
      adapter.toKernelRelative(join(fixture.outside, 'secret.txt'), 'read_file'),
      (error: unknown) => {
        assert.ok(error instanceof WorkspacePathBridgeError);
        assert.equal(error.code, 'PATH_OUTSIDE_WORKSPACE');
        assert.equal(error.rule, 'OUTSIDE_ROOT');
        assert.equal(error.friendly, 'The path is outside the current workspace.');
        assert.match(error.details, /outside the current workspace/u);
        assert.equal(error.path, join(fixture.outside, 'secret.txt'));
        assert.equal(error.operationKind, 'read_file');

        return true;
      },
    );

    assert.throws(
      () => adapter.toHostAbsolute('../secret.txt'),
      (error: unknown) => error instanceof WorkspacePathBridgeError
        && error.code === 'PATH_OUTSIDE_WORKSPACE'
        && error.rule === 'TRAVERSAL',
    );
  });
});

describe('path parity matrix', () => {
  it('preserves the documented path outcomes for every row', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);
    const canonicalRoot = await realpath(fixture.workspace);

    const rows: readonly {
      readonly label: string;
      readonly input: string;
      readonly expectSuccess: boolean;
      readonly expectCode?: string;
      readonly expectRelative?: string;
    }[] = [
      { label: 'relative inside', input: 'notes/draft.md', expectSuccess: true, expectRelative: 'notes/draft.md' },
      {
        label: 'absolute inside',
        input: join(fixture.workspace, 'notes', 'draft.md'),
        expectSuccess: true,
        expectRelative: 'notes/draft.md',
      },
      { label: 'root itself', input: fixture.workspace, expectSuccess: true, expectRelative: '' },
      { label: 'non-existent target', input: 'new/deep/file.txt', expectSuccess: true, expectRelative: 'new/deep/file.txt' },
      {
        label: 'absolute outside',
        input: join(fixture.outside, 'secret.txt'),
        expectSuccess: false,
        expectCode: 'PATH_OUTSIDE_WORKSPACE',
      },
      {
        label: 'sibling prefix',
        input: join(fixture.sibling, 'secret.txt'),
        expectSuccess: false,
        expectCode: 'PATH_OUTSIDE_WORKSPACE',
      },
      { label: 'parent traversal', input: '../outside/secret.txt', expectSuccess: false, expectCode: 'PATH_OUTSIDE_WORKSPACE' },
      {
        label: 'symlink escape',
        input: join(fixture.workspace, 'escape', 'secret.txt'),
        expectSuccess: false,
        expectCode: 'PATH_OUTSIDE_WORKSPACE',
      },
    ];

    for (const row of rows) {
      const adapterResult = await adapter.validate(row.input);

      assert.equal(
        adapterResult.ok,
        row.expectSuccess,
        `${row.label}: adapter success mismatch (${adapterResult.ok ? 'ok' : adapterResult.code})`,
      );

      if (row.expectCode !== undefined) {
        assert.equal(adapterResult.ok ? '' : adapterResult.code, row.expectCode, `row: ${row.label}`);
      }

      if (row.expectRelative !== undefined) {
        assert.equal(adapterResult.ok ? adapterResult.kernelRelative : '', row.expectRelative, `row: ${row.label}`);
        assert.equal(
          adapterResult.ok ? adapterResult.absolutePath : '',
          join(canonicalRoot, row.expectRelative),
          `row: ${row.label}`,
        );
      }
    }
  });

  it('documents the intentional hardening delta for null bytes', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);
    const adapterResult = await adapter.validate('notes/a\u0000b.md');

    // The bridge accepted a null byte and deferred failure to the filesystem call
    // (`ERR_INVALID_ARG_VALUE`, audit A7). The adapter rejects it up front.
    assert.equal(adapterResult.ok, false);
    assert.equal(adapterResult.ok ? '' : adapterResult.code, 'VALIDATION_ERROR');
    assert.equal(adapterResult.ok ? '' : adapterResult.rule, 'NULL_BYTE');
  });
});
