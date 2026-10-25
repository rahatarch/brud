import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkspaceConfigurationError,
  WorkspaceViolationError,
} from '../contracts/errors.js';
import type { WorkspaceWarning } from '../contracts/IWorkspaceService.js';
import { MapPathPort, createIdentityPathPort } from '../testing/MapPathPort.js';
import { WorkspaceService, type WorkspaceServiceOptions } from './WorkspaceService.js';

async function createService(options: WorkspaceServiceOptions): Promise<WorkspaceService> {
  const service = new WorkspaceService(options);

  await service.initialize();

  return service;
}

function violationOf(error: unknown): WorkspaceViolationError {
  assert.ok(error instanceof WorkspaceViolationError, `expected a WorkspaceViolationError, got ${String(error)}`);

  return error;
}

async function assertViolation(
  action: () => Promise<unknown>,
  rule: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => violationOf(error).rule === rule);
}

describe('WorkspaceService — POSIX resolution', () => {
  const port = createIdentityPathPort();

  it('registers and canonicalizes the boot root', async () => {
    const service = await createService({ roots: ['/workspace/'], port });

    assert.deepEqual(service.roots, ['/workspace']);
    assert.equal(service.primaryRoot, '/workspace');
    assert.equal(service.flavor, 'posix');
    assert.equal(service.isInitialized, true);
  });

  it('resolves relative paths against the primary root', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    assert.deepEqual(await service.resolve('notes/draft.md'), {
      root: '/workspace',
      absolutePath: '/workspace/notes/draft.md',
      relativePath: 'notes/draft.md',
    });
    assert.deepEqual(await service.resolve('./notes/./draft.md'), {
      root: '/workspace',
      absolutePath: '/workspace/notes/draft.md',
      relativePath: 'notes/draft.md',
    });
  });

  it('maps the root itself to an empty relative path', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    assert.equal((await service.resolve('')).relativePath, '');
    assert.equal((await service.resolve('.')).relativePath, '');
    assert.equal((await service.resolve('/workspace')).relativePath, '');
    assert.equal((await service.resolve('/workspace')).absolutePath, '/workspace');
  });

  it('accepts absolute paths inside the root', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    const location = await service.resolveContained('/workspace/notes/draft.md');

    assert.equal(location.relativePath, 'notes/draft.md');
    assert.equal(location.absolutePath, '/workspace/notes/draft.md');
  });

  it('rejects absolute paths outside the root', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    await assertViolation(() => service.resolve('/etc/passwd'), 'OUTSIDE_ROOT');
    await assertViolation(() => service.resolve('/workspace/../etc/passwd'), 'OUTSIDE_ROOT');
  });

  it('rejects sibling-prefix paths with a dedicated rule', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    await assertViolation(() => service.resolve('/workspace-evil/secret.txt'), 'SIBLING_PREFIX');
    assert.equal(await service.contains('/workspace-evil/secret.txt'), false);
  });

  it('rejects lexical traversal, null bytes, and non-string input', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    await assertViolation(() => service.resolve('../etc/passwd'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('notes/../../etc/passwd'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('notes/\u0000evil.md'), 'NULL_BYTE');
    await assertViolation(
      () => service.resolve(42 as unknown as string),
      'INVALID_INPUT',
    );
  });

  it('translates between kernel and absolute paths', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    assert.equal(await service.toKernelPath('/workspace/a/b.md'), 'a/b.md');
    assert.equal(await service.toKernelPath('a/b.md'), 'a/b.md');
    assert.equal(service.toAbsolutePath('a/b.md'), '/workspace/a/b.md');
    assert.equal(service.toAbsolutePath(''), '/workspace');
    assert.equal(service.toAbsolutePath('.'), '/workspace');
    assert.equal(service.toAbsolutePath('./a//b//'), '/workspace/a/b');
  });

  it('rejects unsafe kernel descriptors', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    assert.throws(() => service.toAbsolutePath('../outside'), (error: unknown) => violationOf(error).rule === 'TRAVERSAL');
    assert.throws(() => service.toAbsolutePath('/etc/passwd'), (error: unknown) => violationOf(error).rule === 'TRAVERSAL');
    assert.throws(() => service.toAbsolutePath('a\u0000b'), (error: unknown) => violationOf(error).rule === 'NULL_BYTE');
  });

  it('implements contains as a non-throwing predicate', async () => {
    const service = await createService({ roots: ['/workspace'], port });

    assert.equal(await service.contains('/workspace/a.md'), true);
    assert.equal(await service.contains('/workspace'), true);
    assert.equal(await service.contains('/workspace-evil/a.md'), false);
    assert.equal(await service.contains('a\u0000b'), false);
    assert.equal(await service.contains('../a'), false);
  });

  it('rejects non-absolute roots', () => {
    assert.throws(
      () => new WorkspaceService({ roots: ['workspace'], port }),
      WorkspaceConfigurationError,
    );
    assert.throws(
      () => new WorkspaceService({ roots: [], port }),
      WorkspaceConfigurationError,
    );
  });
});

describe('WorkspaceService — symlink containment', () => {
  it('rejects a symlink that escapes the root', async () => {
    const port = new MapPathPort({
      '/workspace': {},
      '/outside': {},
      '/outside/secret.txt': {},
      '/workspace/escape': { target: '/outside' },
    });
    const service = await createService({ roots: ['/workspace'], port });

    await assertViolation(() => service.resolve('escape/secret.txt'), 'SYMLINK_ESCAPE');
    await assertViolation(
      () => service.resolve('/workspace/escape/secret.txt'),
      'SYMLINK_ESCAPE',
    );
    await assertViolation(() => service.resolve('escape/new/deep.txt'), 'SYMLINK_ESCAPE');
    assert.equal(await service.contains('escape/secret.txt'), false);
  });

  it('rejects a dangling symlink', async () => {
    const port = new MapPathPort({
      '/workspace': {},
      '/workspace/dangling': { target: '/outside/missing' },
    });
    const service = await createService({ roots: ['/workspace'], port });

    await assertViolation(() => service.resolve('dangling/x.txt'), 'SYMLINK_ESCAPE');
  });

  it('admits a symlink that stays inside the root and reports the canonical target', async () => {
    const port = new MapPathPort({
      '/workspace': {},
      '/workspace/notes': {},
      '/workspace/notes/a.md': {},
      '/workspace/inner': { target: '/workspace/notes' },
    });
    const service = await createService({ roots: ['/workspace'], port });

    const location = await service.resolve('inner/a.md');

    assert.equal(location.absolutePath, '/workspace/notes/a.md');
  });

  it('rejects a root that canonicalizes onto the filesystem root', async () => {
    const port = new MapPathPort({
      '/': {},
      '/workspace': { target: '/' },
    });
    const service = new WorkspaceService({ roots: ['/workspace'], port });

    await assert.rejects(service.initialize(), (error: unknown) =>
      error instanceof WorkspaceConfigurationError && error.rule === 'FILESYSTEM_ROOT');
  });

  it('rejects a filesystem root unless explicitly allowed', async () => {
    const port = createIdentityPathPort();

    assert.throws(
      () => new WorkspaceService({ roots: ['/'], port }),
      (error: unknown) => error instanceof WorkspaceConfigurationError
        && error.rule === 'FILESYSTEM_ROOT',
    );

    const allowed = await createService({ roots: ['/'], port, allowFilesystemRoot: true });

    assert.deepEqual(allowed.roots, ['/']);
    assert.equal((await allowed.resolve('etc/passwd')).relativePath, 'etc/passwd');
  });
});

describe('WorkspaceService — batch-scoped cache', () => {
  it('reuses canonicalization for existing paths inside one batch', async () => {
    const port = new MapPathPort({ '/workspace': {}, '/workspace/a.md': {} });
    const service = await createService({ roots: ['/workspace'], port });
    const batch = service.createBatch();

    await batch.resolve('a.md');
    await batch.resolve('a.md');

    assert.deepEqual(batch.stats, { hits: 1, misses: 1 });
  });

  it('does not reuse canonicalization for non-existent targets', async () => {
    const port = new MapPathPort({ '/workspace': {} });
    const service = await createService({ roots: ['/workspace'], port });
    const batch = service.createBatch();

    const first = await batch.resolve('new/file.md');
    const second = await batch.resolve('new/file.md');

    assert.equal(first.absolutePath, second.absolutePath);
    assert.deepEqual(batch.stats, { hits: 0, misses: 2 });
  });

  it('keeps batches isolated from each other', async () => {
    const port = new MapPathPort({ '/workspace': {}, '/workspace/a.md': {} });
    const service = await createService({ roots: ['/workspace'], port });
    const first = service.createBatch();
    const second = service.createBatch();

    await first.resolve('a.md');
    await second.resolve('a.md');

    assert.deepEqual(first.stats, { hits: 0, misses: 1 });
    assert.deepEqual(second.stats, { hits: 0, misses: 1 });
  });

  it('enforces the same boundary as the unbounded service', async () => {
    const port = new MapPathPort({
      '/workspace': {},
      '/workspace-evil': {},
      '/workspace-evil/secret.txt': {},
    });
    const service = await createService({ roots: ['/workspace'], port });
    const batch = service.createBatch();

    assert.equal(await batch.contains('/workspace-evil/secret.txt'), false);
    await assertViolation(() => batch.toKernelPath('/workspace-evil/secret.txt'), 'SIBLING_PREFIX');
  });
});

describe('WorkspaceService — multi-root routing', () => {
  const options: WorkspaceServiceOptions = {
    roots: ['/workspace/client', '/workspace/server'],
    primaryRoot: '/workspace/client',
    port: createIdentityPathPort(),
  };

  it('routes absolute paths to the owning root', async () => {
    const service = await createService(options);

    assert.deepEqual(await service.resolve('/workspace/server/src/a.ts'), {
      root: '/workspace/server',
      absolutePath: '/workspace/server/src/a.ts',
      relativePath: 'src/a.ts',
    });
    assert.equal(service.primaryRoot, '/workspace/client');
  });

  it('resolves relative paths against the primary root unless a hint is given', async () => {
    const service = await createService(options);

    assert.equal((await service.resolve('src/a.ts')).relativePath, 'src/a.ts');
    assert.equal((await service.resolve('src/a.ts')).root, '/workspace/client');
    assert.equal(
      (await service.resolveInRoot('/workspace/server', 'src/a.ts')).root,
      '/workspace/server',
    );
  });

  it('rejects an unregistered root hint', async () => {
    const service = await createService(options);

    await assertViolation(() => service.resolveInRoot('/workspace/other', 'a.ts'), 'UNKNOWN_ROOT');
  });

  it('refuses cross-root traversal while routing normalized paths by real owner', async () => {
    const service = await createService(options);

    await assertViolation(() => service.resolveInRoot('/workspace/client', '../server/src/a.ts'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('/workspace/client/../../outside/a.ts'), 'OUTSIDE_ROOT');

    const normalized = await service.resolve('/workspace/client/../server/src/a.ts');

    assert.equal(normalized.root, '/workspace/server');
    assert.equal(normalized.relativePath, 'src/a.ts');
  });

  it('reports overlapping roots as ambiguous instead of guessing', async () => {
    const warnings: WorkspaceWarning[] = [];
    const service = await createService({
      roots: ['/workspace', '/workspace/sub'],
      port: createIdentityPathPort(),
      onWarning: (warning) => warnings.push(warning),
    });

    assert.equal(warnings.some((warning) => warning.code === 'ROOT_OVERLAP'), true);
    await assertViolation(() => service.resolve('/workspace/sub/a.ts'), 'AMBIGUOUS_ROOT');
  });

  it('collapses duplicate root declarations with a warning', async () => {
    const warnings: WorkspaceWarning[] = [];
    const service = await createService({
      roots: ['/workspace', '/workspace/'],
      port: createIdentityPathPort(),
      onWarning: (warning) => warnings.push(warning),
    });

    assert.deepEqual(service.roots, ['/workspace']);
    assert.equal(warnings.some((warning) => warning.code === 'ROOT_DUPLICATE'), true);
  });
});

describe('WorkspaceService — Windows semantics', () => {
  const port = createIdentityPathPort();

  it('canonicalizes drive case and trailing separators', async () => {
    const service = await createService({ roots: ['c:\\Users\\Dev\\Workspace\\'], port, flavor: 'win32' });

    assert.deepEqual(service.roots, ['C:\\Users\\Dev\\Workspace']);
    assert.equal(service.primaryRoot, 'C:\\Users\\Dev\\Workspace');
  });

  it('accepts absolute paths inside the root across separators and case', async () => {
    const service = await createService({ roots: ['C:\\Users\\Dev\\Workspace'], port, flavor: 'win32' });

    assert.equal((await service.resolve('notes\\a.md')).relativePath, 'notes/a.md');
    assert.equal(
      (await service.resolve('c:/users/dev/workspace/notes/a.md')).relativePath,
      'notes/a.md',
    );
    assert.equal(
      (await service.resolve('C:\\Users\\Dev\\Workspace\\notes\\a.md')).relativePath,
      'notes/a.md',
    );
  });

  it('rejects case-sensitive siblings and other roots', async () => {
    const service = await createService({ roots: ['C:\\Users\\Dev\\Workspace'], port, flavor: 'win32' });

    await assertViolation(
      () => service.resolve('c:\\users\\dev\\workspace-evil\\a.md'),
      'SIBLING_PREFIX',
    );
    await assertViolation(() => service.resolve('D:\\Users\\Dev\\Workspace\\a.md'), 'OUTSIDE_ROOT');
  });

  it('rejects drive-relative, UNC, and device paths', async () => {
    const service = await createService({ roots: ['C:\\Users\\Dev\\Workspace'], port, flavor: 'win32' });

    await assertViolation(() => service.resolve('C:notes\\a.md'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('\\\\server\\share\\a.md'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('\\\\?\\C:\\Users\\Dev\\Workspace\\a.md'), 'TRAVERSAL');
  });

  it('applies reserved device, ADS, and trailing dot/space rules', async () => {
    const service = await createService({ roots: ['C:\\Users\\Dev\\Workspace'], port, flavor: 'win32' });

    await assertViolation(() => service.resolve('nul'), 'RESERVED_DEVICE');
    await assertViolation(() => service.resolve('CON.txt'), 'RESERVED_DEVICE');
    await assertViolation(() => service.resolve('file.txt:stream'), 'ALTERNATE_DATA_STREAM');
    await assertViolation(() => service.resolve('a.'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('.. \\secret.txt'), 'TRAVERSAL');
  });

  it('returns host-native absolute paths for kernel descriptors', async () => {
    const service = await createService({ roots: ['C:\\Users\\Dev\\Workspace'], port, flavor: 'win32' });

    assert.equal(
      service.toAbsolutePath('notes/a.md'),
      'C:\\Users\\Dev\\Workspace\\notes\\a.md',
    );
    assert.equal(service.toAbsolutePath(''), 'C:\\Users\\Dev\\Workspace');
  });

  it('rejects a volume root unless explicitly allowed', () => {
    assert.throws(
      () => new WorkspaceService({ roots: ['C:\\'], port, flavor: 'win32' }),
      (error: unknown) => error instanceof WorkspaceConfigurationError
        && error.rule === 'FILESYSTEM_ROOT',
    );
  });

  it('rejects UNC and device roots outright', () => {
    assert.throws(
      () => new WorkspaceService({ roots: ['\\\\server\\share'], port, flavor: 'win32' }),
      WorkspaceConfigurationError,
    );
  });
});
