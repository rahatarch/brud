import { chmod, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import type { IWorkspacePathPort } from '../contracts/IWorkspaceService.js';
import { WorkspaceViolationError } from '../contracts/errors.js';
import { createLegacyPathAdapter } from '../legacy/LegacyPathAdapter.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import { createIdentityPathPort, MapPathPort } from '../testing/MapPathPort.js';
import { WorkspaceService } from './WorkspaceService.js';

const CONTROL_CHARACTER_PATTERN = /[\r\n\0]/;

const posixOnly = process.platform === 'win32'
  ? { skip: 'POSIX permission and symlink semantics are required' }
  : {};

const nonRootOnly = process.platform === 'win32' || process.getuid?.() === 0
  ? { skip: 'permission denial cannot be observed as root or on win32' }
  : {};

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly outside: string;
}

async function createFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-workspace-remediation-')));
  const workspace = join(base, 'workspace');
  const outside = join(base, 'outside');

  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET', 'utf8');

  return { base, workspace, outside };
}

async function createRealService(workspace: string): Promise<WorkspaceService> {
  const service = new WorkspaceService({
    roots: [workspace],
    port: createStorageDriverPathPort(new NodeStorageDriver()),
    flavor: 'posix',
  });

  await service.initialize();

  return service;
}

async function createLexicalService(
  roots: readonly string[],
  options?: { readonly primaryRoot?: string; readonly port?: IWorkspacePathPort },
): Promise<WorkspaceService> {
  const service = new WorkspaceService({
    roots,
    port: options?.port ?? createIdentityPathPort(),
    flavor: 'posix',
    ...(options?.primaryRoot === undefined ? {} : { primaryRoot: options.primaryRoot }),
  });

  await service.initialize();

  return service;
}

async function captureViolation(action: () => Promise<unknown>): Promise<WorkspaceViolationError> {
  try {
    await action();
  } catch (error: unknown) {
    assert.ok(
      error instanceof WorkspaceViolationError,
      `expected a WorkspaceViolationError, got ${String(error)}`,
    );

    return error;
  }

  assert.fail('expected the call to be rejected');
}

function assertSanitized(value: string | undefined): void {
  assert.ok(value !== undefined);
  assert.doesNotMatch(value, CONTROL_CHARACTER_PATTERN);
}

describe('WorkspaceService remediation — fail-closed ancestor lineage (F1)', () => {
  it('throws UNVERIFIABLE_LINEAGE instead of falling back when an ancestor is unreadable', nonRootOnly, async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const locked = join(fixture.workspace, 'locked');
    await mkdir(locked, { recursive: true });
    await symlink(fixture.outside, join(locked, 'escape'), 'dir');

    const service = await createRealService(fixture.workspace);
    await chmod(locked, 0o000);

    try {
      const relative = await captureViolation(() => service.resolve('locked/escape/secret.txt'));

      assert.ok(
        relative.rule === 'UNVERIFIABLE_LINEAGE' || relative.rule === 'SYMLINK_ESCAPE',
        `expected a fail-closed rule, got ${String(relative.rule)}`,
      );
      assert.notEqual(relative.rule, 'OUTSIDE_ROOT');

      const absolute = await captureViolation(() =>
        service.resolve(join(fixture.workspace, 'locked', 'escape', 'secret.txt')));

      assert.ok(
        absolute.rule === 'UNVERIFIABLE_LINEAGE' || absolute.rule === 'SYMLINK_ESCAPE',
      );
      assert.equal(await service.contains('locked/escape/secret.txt'), false);
    } finally {
      await chmod(locked, 0o755);
    }
  });
});

describe('WorkspaceService remediation — batch cache TOCTOU (F2)', () => {
  it('detects a file swapped for an escaping symlink inside one batch', posixOnly, async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const target = join(fixture.workspace, 'swap.txt');
    await writeFile(target, 'in-workspace', 'utf8');

    const service = await createRealService(fixture.workspace);
    const batch = service.createBatch();

    const first = await batch.resolve('swap.txt');

    assert.equal(first.relativePath, 'swap.txt');
    assert.deepEqual(batch.stats, { hits: 0, misses: 1 });

    await unlink(target);
    await symlink(join(fixture.outside, 'secret.txt'), target);

    const swapped = await captureViolation(() => batch.resolve('swap.txt'));

    assert.equal(swapped.rule, 'SYMLINK_ESCAPE');
  });
});

describe('WorkspaceService remediation — authoritative root hints (F4)', () => {
  it('rejects an absolute path that belongs to another known root', async () => {
    const service = await createLexicalService(['/workspace/root-a', '/workspace/root-b']);

    const violation = await captureViolation(() =>
      service.resolveInRoot('/workspace/root-b', '/workspace/root-a/file.txt'));

    assert.equal(violation.rule, 'OUTSIDE_ROOT');

    const allowed = await service.resolveInRoot('/workspace/root-a', '/workspace/root-a/file.txt');

    assert.equal(allowed.root, '/workspace/root-a');
    assert.equal(allowed.relativePath, 'file.txt');
  });
});

describe('WorkspaceService remediation — root round-trip and nested hints (F5)', () => {
  it('uses the hint to disambiguate overlapping roots', async () => {
    const service = await createLexicalService(['/repo', '/repo/packages/core']);

    const nested = await service.resolveInRoot('/repo/packages/core', 'file.txt');

    assert.equal(nested.root, '/repo/packages/core');
    assert.equal(nested.absolutePath, '/repo/packages/core/file.txt');
    assert.equal(nested.relativePath, 'file.txt');

    const unhinted = await captureViolation(() => service.resolve('/repo/packages/core/file.txt'));

    assert.equal(unhinted.rule, 'AMBIGUOUS_ROOT');
  });

  it('round-trips a secondary root through location.root', async () => {
    const service = await createLexicalService(['/workspace/client', '/workspace/server']);

    const location = await service.resolve('/workspace/server/src/a.ts');

    assert.equal(service.toAbsolutePath(location.relativePath, location.root), location.absolutePath);
    assert.equal(service.toAbsolutePath('src/a.ts'), '/workspace/client/src/a.ts');

    const unknown = await captureViolation(async () =>
      service.toAbsolutePath('src/a.ts', '/workspace/unknown'));

    assert.equal(unknown.rule, 'UNKNOWN_ROOT');
  });
});

describe('WorkspaceService remediation — error payload safety (F6, F7)', () => {
  it('never emits raw control characters in violations', async () => {
    const service = await createLexicalService(['/workspace']);
    const candidates = [
      '../outside\nATTACK: SUCCESS\n',
      'notes/../../\nATTACK\r\nsecret.txt',
      'evil\0hidden.txt',
    ];

    for (const candidate of candidates) {
      const violation = await captureViolation(() => service.resolve(candidate));

      assertSanitized(violation.message);
      assertSanitized(violation.reason);
      assertSanitized(violation.candidatePath);
    }
  });

  it('sanitizes legacy adapter details', async () => {
    const service = await createLexicalService(['/workspace']);
    const adapter = createLegacyPathAdapter(service);

    const result = await adapter.validate('../outside\nATTACK\r\n.txt');

    assert.equal(result.ok, false);

    if (!result.ok) {
      assertSanitized(result.details);
      assertSanitized(result.friendly);
      assert.doesNotMatch(result.details, /\nATTACK/);
    }
  });

  it('withholds the absolute root from relative callers', async () => {
    const port = new MapPathPort({
      '/workspace': {},
      '/outside': {},
      '/outside/secret.txt': {},
      '/workspace/escape': { target: '/outside' },
    });
    const service = await createLexicalService(['/workspace'], { port });

    const traversal = await captureViolation(() => service.resolve('../outside.txt'));

    assert.equal(traversal.root, undefined);
    assert.ok(!traversal.message.includes('/workspace'));

    const escape = await captureViolation(() => service.resolve('escape/secret.txt'));

    assert.equal(escape.rule, 'SYMLINK_ESCAPE');
    assert.equal(escape.root, undefined);
    assert.ok(!escape.message.includes('/workspace'));

    const absolute = await captureViolation(() =>
      service.resolve('/workspace/escape/secret.txt'));

    assert.equal(absolute.rule, 'SYMLINK_ESCAPE');
    assert.equal(absolute.root, '/workspace');
  });
});
