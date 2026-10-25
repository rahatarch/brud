import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { WorkspaceService } from '../orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import {
  LegacyPathError,
  WorkspacePathAdapter,
  createLegacyPathAdapter,
} from './LegacyPathAdapter.js';

interface LegacyValidationResult {
  readonly success: boolean;
  readonly code?: string;
  readonly data?: { readonly resolvedPath?: string };
}

interface LegacyApiModule {
  readonly BrudAPI: {
    readonly validate: {
      path(path: string, workspaceFolders: string[]): LegacyValidationResult;
    };
  };
}

/**
 * Loads the legacy `BrudAPI` as a runtime-only dependency.
 *
 * The URL is computed so `tsc` never resolves the core package from the kernel
 * build: the parity oracle is a test-time comparison, not a kernel dependency.
 */
async function loadLegacyApi(): Promise<LegacyApiModule> {
  const specifier = new URL('../../../../core/src/api/index.ts', import.meta.url).href;

  return await import(specifier) as LegacyApiModule;
}

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly outside: string;
  readonly sibling: string;
}

async function createFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-legacy-adapter-')));
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

async function createAdapter(workspace: string): Promise<WorkspacePathAdapter> {
  const service = new WorkspaceService({
    roots: [workspace],
    port: createStorageDriverPathPort(new NodeStorageDriver()),
    flavor: 'posix',
  });
  await service.initialize();

  return createLegacyPathAdapter(service);
}

describe('WorkspacePathAdapter translation', () => {
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

    assert.equal(adapter.toLegacyAbsolute('notes/draft.md'), join(canonicalRoot, 'notes', 'draft.md'));
    assert.equal(adapter.toLegacyAbsolute(''), canonicalRoot);

    const roundTrip = adapter.toLegacyAbsolute(await adapter.toKernelRelative(join(fixture.workspace, 'notes', 'draft.md')));

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

  it('throws legacy-coded errors with the legacy field shape', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const adapter = await createAdapter(fixture.workspace);

    await assert.rejects(
      adapter.toKernelRelative(join(fixture.outside, 'secret.txt'), 'read_file'),
      (error: unknown) => {
        assert.ok(error instanceof LegacyPathError);
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
      () => adapter.toLegacyAbsolute('../secret.txt'),
      (error: unknown) => error instanceof LegacyPathError
        && error.code === 'PATH_OUTSIDE_WORKSPACE'
        && error.rule === 'TRAVERSAL',
    );
  });
});

describe('legacy path parity matrix', () => {
  it('matches legacy BrudAPI.validate outcomes for every row', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const legacy = await loadLegacyApi();
    const adapter = await createAdapter(fixture.workspace);
    const canonicalRoot = await realpath(fixture.workspace);
    const folders = [canonicalRoot];

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
      const legacyResult = legacy.BrudAPI.validate.path(row.input, folders);
      const adapterResult = await adapter.validate(row.input);

      assert.equal(
        adapterResult.ok,
        row.expectSuccess,
        `${row.label}: adapter success mismatch (${adapterResult.ok ? 'ok' : adapterResult.code})`,
      );
      assert.equal(
        legacyResult.success,
        row.expectSuccess,
        `${row.label}: legacy success mismatch (${legacyResult.code ?? 'ok'})`,
      );
      assert.equal(adapterResult.ok, legacyResult.success, `${row.label}: parity mismatch`);

      if (row.expectCode !== undefined) {
        assert.equal(adapterResult.ok ? '' : adapterResult.code, row.expectCode, `row: ${row.label}`);
        assert.equal(legacyResult.code, row.expectCode, `row: ${row.label}`);
      }

      if (row.expectRelative !== undefined) {
        assert.equal(adapterResult.ok ? adapterResult.kernelRelative : '', row.expectRelative, `row: ${row.label}`);
        assert.equal(
          legacyResult.data?.resolvedPath,
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

    const legacy = await loadLegacyApi();
    const adapter = await createAdapter(fixture.workspace);

    const legacyResult = legacy.BrudAPI.validate.path('notes/a\u0000b.md', [fixture.workspace]);
    const adapterResult = await adapter.validate('notes/a\u0000b.md');

    // Legacy accepts a null byte and defers failure to the filesystem call
    // (`ERR_INVALID_ARG_VALUE`, audit A7). The adapter rejects it up front.
    assert.equal(legacyResult.success, true);
    assert.equal(adapterResult.ok, false);
    assert.equal(adapterResult.ok ? '' : adapterResult.code, 'VALIDATION_ERROR');
    assert.equal(adapterResult.ok ? '' : adapterResult.rule, 'NULL_BYTE');
  });
});
