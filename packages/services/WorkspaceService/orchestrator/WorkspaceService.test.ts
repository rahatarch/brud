import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageDriver } from '@brud/kernel';
import {
  WorkspaceConfigurationError,
  WorkspaceViolationError,
} from '../contracts/errors.js';
import type { WorkspaceWarning } from '../contracts/IWorkspaceService.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import { WorkspaceService, type WorkspaceServiceOptions } from './WorkspaceService.js';

let base = '';
let caseCounter = 0;

before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'brud-workspace-service-')));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

function realPort(): ReturnType<typeof createStorageDriverPathPort> {
  return createStorageDriverPathPort(new NodeStorageDriver());
}

async function makeRoot(name = 'workspace'): Promise<string> {
  caseCounter += 1;
  const root = join(base, `case-${caseCounter}`, name);
  await mkdir(root, { recursive: true });
  return root;
}

async function makeMultiRoot(): Promise<{ parent: string; client: string; server: string }> {
  caseCounter += 1;
  const parent = join(base, `case-${caseCounter}`);
  const client = join(parent, 'client');
  const server = join(parent, 'server');
  await mkdir(client, { recursive: true });
  await mkdir(server, { recursive: true });
  return { parent, client, server };
}

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
  it('registers and canonicalizes the boot root', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [`${root}/`], port: realPort() });

    assert.deepEqual(service.roots, [root]);
    assert.equal(service.primaryRoot, root);
    if (process.platform !== 'win32') {
      assert.equal(service.flavor, 'posix');
    }
    assert.equal(service.isInitialized, true);
  });

  it('resolves relative paths against the primary root', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    assert.deepEqual(await service.resolve('notes/draft.md'), {
      root,
      absolutePath: join(root, 'notes/draft.md'),
      relativePath: 'notes/draft.md',
    });
    assert.deepEqual(await service.resolve('./notes/./draft.md'), {
      root,
      absolutePath: join(root, 'notes/draft.md'),
      relativePath: 'notes/draft.md',
    });
  });

  it('maps the root itself to an empty relative path', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    assert.equal((await service.resolve('')).relativePath, '');
    assert.equal((await service.resolve('.')).relativePath, '');
    assert.equal((await service.resolve(root)).relativePath, '');
    assert.equal((await service.resolve(root)).absolutePath, root);
  });

  it('accepts absolute paths inside the root', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    const location = await service.resolveContained(join(root, 'notes/draft.md'));

    assert.equal(location.relativePath, 'notes/draft.md');
    assert.equal(location.absolutePath, join(root, 'notes/draft.md'));
  });

  it('rejects absolute paths outside the root', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    await assertViolation(() => service.resolve('/etc/passwd'), 'OUTSIDE_ROOT');
    await assertViolation(() => service.resolve(join(root, '..', 'etc/passwd')), 'OUTSIDE_ROOT');
  });

  it('rejects sibling-prefix paths with a dedicated rule', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    await assertViolation(() => service.resolve(`${root}-evil/secret.txt`), 'SIBLING_PREFIX');
    assert.equal(await service.contains(`${root}-evil/secret.txt`), false);
  });

  it('rejects lexical traversal, null bytes, and non-string input', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    await assertViolation(() => service.resolve('../etc/passwd'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('notes/../../etc/passwd'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('notes/\u0000evil.md'), 'NULL_BYTE');
    await assertViolation(
      () => service.resolve(42 as unknown as string),
      'INVALID_INPUT',
    );
  });

  it('translates between kernel and absolute paths', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    assert.equal(await service.toKernelPath(join(root, 'a/b.md')), 'a/b.md');
    assert.equal(await service.toKernelPath('a/b.md'), 'a/b.md');
    assert.equal(service.toAbsolutePath('a/b.md'), join(root, 'a/b.md'));
    assert.equal(service.toAbsolutePath(''), root);
    assert.equal(service.toAbsolutePath('.'), root);
    assert.equal(service.toAbsolutePath('./a//b//'), join(root, 'a/b'));
  });

  it('rejects unsafe kernel descriptors', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    assert.throws(() => service.toAbsolutePath('../outside'), (error: unknown) => violationOf(error).rule === 'TRAVERSAL');
    assert.throws(() => service.toAbsolutePath('/etc/passwd'), (error: unknown) => violationOf(error).rule === 'TRAVERSAL');
    assert.throws(() => service.toAbsolutePath('a\u0000b'), (error: unknown) => violationOf(error).rule === 'NULL_BYTE');
  });

  it('implements contains as a non-throwing predicate', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });

    assert.equal(await service.contains(join(root, 'a.md')), true);
    assert.equal(await service.contains(root), true);
    assert.equal(await service.contains(`${root}-evil/a.md`), false);
    assert.equal(await service.contains('a\u0000b'), false);
    assert.equal(await service.contains('../a'), false);
  });

  it('rejects non-absolute roots', () => {
    assert.throws(
      () => new WorkspaceService({ roots: ['workspace'], port: realPort() }),
      WorkspaceConfigurationError,
    );
    assert.throws(
      () => new WorkspaceService({ roots: [], port: realPort() }),
      WorkspaceConfigurationError,
    );
  });
});

describe('WorkspaceService — symlink containment', () => {
  it('rejects a symlink that escapes the root', async () => {
    const root = await makeRoot();
    const outside = join(base, `outside-${caseCounter}`);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(root, 'escape'));

    const service = await createService({ roots: [root], port: realPort() });

    await assertViolation(() => service.resolve('escape/secret.txt'), 'SYMLINK_ESCAPE');
    await assertViolation(
      () => service.resolve(join(root, 'escape/secret.txt')),
      'SYMLINK_ESCAPE',
    );
    await assertViolation(() => service.resolve('escape/new/deep.txt'), 'SYMLINK_ESCAPE');
    assert.equal(await service.contains('escape/secret.txt'), false);
  });

  it('rejects a dangling symlink', async () => {
    const root = await makeRoot();
    await symlink(join(base, 'missing-target'), join(root, 'dangling'));

    const service = await createService({ roots: [root], port: realPort() });

    await assertViolation(() => service.resolve('dangling/x.txt'), 'SYMLINK_ESCAPE');
  });

  it('admits a symlink that stays inside the root and reports the canonical target', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes/a.md'), 'a');
    await symlink(join(root, 'notes'), join(root, 'inner'));

    const service = await createService({ roots: [root], port: realPort() });

    const location = await service.resolve('inner/a.md');

    assert.equal(location.absolutePath, join(root, 'notes/a.md'));
  });

  it('rejects a root that canonicalizes onto the filesystem root', async () => {
    caseCounter += 1;
    const parent = join(base, `case-${caseCounter}`);
    await mkdir(parent, { recursive: true });
    const link = join(parent, 'root-link');
    await symlink('/', link);

    const service = new WorkspaceService({ roots: [link], port: realPort() });

    await assert.rejects(service.initialize(), (error: unknown) =>
      error instanceof WorkspaceConfigurationError && error.rule === 'FILESYSTEM_ROOT');
  });

  it('rejects a filesystem root unless explicitly allowed', async () => {
    // POSIX root resolution: on win32 `/` denotes the current drive root, so
    // the FILESYSTEM_ROOT contract is exercised differently.
    if (process.platform === 'win32') {
      return;
    }
    const port = realPort();

    assert.throws(
      () => new WorkspaceService({ roots: ['/'], port }),
      (error: unknown) => error instanceof WorkspaceConfigurationError
        && error.rule === 'FILESYSTEM_ROOT',
    );

    const allowed = await createService({ roots: ['/'], port, allowFilesystemRoot: true });

    assert.deepEqual(allowed.roots, ['/']);
    // `/etc` is a symlink to `/private/etc` on macOS, so the canonical relative
    // path is derived from the host's real path rather than the input spelling.
    const canonicalRoot = await realpath('/');
    const canonicalTarget = await realpath(join('/', 'etc', 'passwd'));
    const expected = canonicalTarget.slice(canonicalRoot.length).replace(/^[/\\]+/u, '');
    assert.equal((await allowed.resolve('etc/passwd')).relativePath, expected);
  });
});

describe('WorkspaceService — batch-scoped cache', () => {
  it('reuses canonicalization for existing paths inside one batch', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.md'), 'a');
    const service = await createService({ roots: [root], port: realPort() });
    const batch = service.createBatch();

    await batch.resolve('a.md');
    await batch.resolve('a.md');

    assert.deepEqual(batch.stats, { hits: 1, misses: 1 });
  });

  it('does not reuse canonicalization for non-existent targets', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });
    const batch = service.createBatch();

    const first = await batch.resolve('new/file.md');
    const second = await batch.resolve('new/file.md');

    assert.equal(first.absolutePath, second.absolutePath);
    assert.deepEqual(batch.stats, { hits: 0, misses: 2 });
  });

  it('keeps batches isolated from each other', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'a.md'), 'a');
    const service = await createService({ roots: [root], port: realPort() });
    const first = service.createBatch();
    const second = service.createBatch();

    await first.resolve('a.md');
    await second.resolve('a.md');

    assert.deepEqual(first.stats, { hits: 0, misses: 1 });
    assert.deepEqual(second.stats, { hits: 0, misses: 1 });
  });

  it('enforces the same boundary as the unbounded service', async () => {
    const root = await makeRoot();
    const service = await createService({ roots: [root], port: realPort() });
    const batch = service.createBatch();

    assert.equal(await batch.contains(`${root}-evil/secret.txt`), false);
    await assertViolation(() => batch.toKernelPath(`${root}-evil/secret.txt`), 'SIBLING_PREFIX');
  });
});

describe('WorkspaceService — multi-root routing', () => {
  it('routes absolute paths to the owning root', async () => {
    const { client, server } = await makeMultiRoot();
    const service = await createService({
      roots: [client, server],
      primaryRoot: client,
      port: realPort(),
    });

    assert.deepEqual(await service.resolve(join(server, 'src/a.ts')), {
      root: server,
      absolutePath: join(server, 'src/a.ts'),
      relativePath: 'src/a.ts',
    });
    assert.equal(service.primaryRoot, client);
  });

  it('resolves relative paths against the primary root unless a hint is given', async () => {
    const { client, server } = await makeMultiRoot();
    const service = await createService({
      roots: [client, server],
      primaryRoot: client,
      port: realPort(),
    });

    assert.equal((await service.resolve('src/a.ts')).relativePath, 'src/a.ts');
    assert.equal((await service.resolve('src/a.ts')).root, client);
    assert.equal(
      (await service.resolveInRoot(server, 'src/a.ts')).root,
      server,
    );
  });

  it('rejects an unregistered root hint', async () => {
    const { client, server } = await makeMultiRoot();
    const service = await createService({
      roots: [client, server],
      primaryRoot: client,
      port: realPort(),
    });

    await assertViolation(() => service.resolveInRoot(join(base, 'other'), 'a.ts'), 'UNKNOWN_ROOT');
  });

  it('refuses cross-root traversal while routing normalized paths by real owner', async () => {
    const { client, server } = await makeMultiRoot();
    const service = await createService({
      roots: [client, server],
      primaryRoot: client,
      port: realPort(),
    });

    await assertViolation(() => service.resolveInRoot(client, '../server/src/a.ts'), 'TRAVERSAL');
    await assertViolation(() => service.resolve(join(client, '../../outside/a.ts')), 'OUTSIDE_ROOT');

    const normalized = await service.resolve(join(client, '../server/src/a.ts'));

    assert.equal(normalized.root, server);
    assert.equal(normalized.relativePath, 'src/a.ts');
  });

  it('reports overlapping roots as ambiguous instead of guessing', async () => {
    const { parent, server } = await makeMultiRoot();
    const warnings: WorkspaceWarning[] = [];
    const service = await createService({
      roots: [parent, server],
      port: realPort(),
      onWarning: (warning) => warnings.push(warning),
    });

    assert.equal(warnings.some((warning) => warning.code === 'ROOT_OVERLAP'), true);
    await assertViolation(() => service.resolve(join(server, 'a.ts')), 'AMBIGUOUS_ROOT');
  });

  it('collapses duplicate root declarations with a warning', async () => {
    const { parent } = await makeMultiRoot();
    const warnings: WorkspaceWarning[] = [];
    const service = await createService({
      roots: [parent, `${parent}/`],
      port: realPort(),
      onWarning: (warning) => warnings.push(warning),
    });

    assert.deepEqual(service.roots, [parent]);
    assert.equal(warnings.some((warning) => warning.code === 'ROOT_DUPLICATE'), true);
  });
});

const WINDOWS_ROOT = 'C:\\Users\\Dev\\Workspace';

function windowsPort(): ReturnType<typeof createStorageDriverPathPort> {
  return createStorageDriverPathPort(new NodeStorageDriver());
}

async function createWindowsService(): Promise<WorkspaceService> {
  return createService({
    roots: [WINDOWS_ROOT],
    port: windowsPort(),
    flavor: 'win32',
  });
}

describe('WorkspaceService — Windows semantics', () => {
  it('canonicalizes drive case and trailing separators', async () => {
    const service = await createService({
      roots: ['c:\\Users\\Dev\\Workspace\\'],
      port: windowsPort(),
      flavor: 'win32',
    });

    assert.deepEqual(service.roots, [WINDOWS_ROOT]);
    assert.equal(service.flavor, 'win32');
  });

  it('accepts absolute paths inside the root across separators and case', async () => {
    const service = await createWindowsService();

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
    const service = await createWindowsService();

    await assertViolation(
      () => service.resolve('c:\\users\\dev\\workspace-evil\\a.md'),
      'SIBLING_PREFIX',
    );
    await assertViolation(
      () => service.resolve('D:\\Users\\Dev\\Workspace\\a.md'),
      'OUTSIDE_ROOT',
    );
  });

  it('rejects drive-relative, UNC, and device paths', async () => {
    const service = await createWindowsService();

    await assertViolation(() => service.resolve('C:notes\\a.md'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('\\\\server\\share\\a.md'), 'TRAVERSAL');
    await assertViolation(
      () => service.resolve('\\\\?\\C:\\Users\\Dev\\Workspace\\a.md'),
      'TRAVERSAL',
    );
  });

  it('applies reserved device, ADS, and trailing dot/space rules', async () => {
    const service = await createWindowsService();

    await assertViolation(() => service.resolve('nul'), 'RESERVED_DEVICE');
    await assertViolation(() => service.resolve('CON.txt'), 'RESERVED_DEVICE');
    await assertViolation(() => service.resolve('file.txt:stream'), 'ALTERNATE_DATA_STREAM');
    await assertViolation(() => service.resolve('a.'), 'TRAVERSAL');
    await assertViolation(() => service.resolve('.. \\secret.txt'), 'TRAVERSAL');
  });

  it('returns host-native absolute paths for kernel descriptors', async () => {
    const service = await createWindowsService();

    assert.equal(
      service.toAbsolutePath('notes/a.md'),
      'C:\\Users\\Dev\\Workspace\\notes\\a.md',
    );
    assert.equal(service.toAbsolutePath(''), WINDOWS_ROOT);
  });

  it('rejects a volume root unless explicitly allowed', async () => {
    assert.throws(
      () =>
        new WorkspaceService({
          roots: ['C:\\'],
          port: windowsPort(),
          flavor: 'win32',
        }),
      (error: unknown) => error instanceof WorkspaceConfigurationError
        && error.rule === 'FILESYSTEM_ROOT',
    );
  });

  it('rejects UNC and device roots outright', async () => {
    assert.throws(
      () =>
        new WorkspaceService({
          roots: ['\\\\server\\share'],
          port: windowsPort(),
          flavor: 'win32',
        }),
      (error: unknown) => error instanceof WorkspaceConfigurationError,
    );
  });
});