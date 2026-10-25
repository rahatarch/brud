import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { WorkspaceViolationError } from '../contracts/errors.js';
import { createStorageDriverPathPort } from '../ports/StorageDriverPathPort.js';
import { WorkspaceService } from './WorkspaceService.js';

const driver = new NodeStorageDriver();
const port = createStorageDriverPathPort(driver);
const symlinkSkip = process.platform === 'win32'
  ? { skip: 'symlink creation requires elevated privileges on Windows' }
  : {};

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly outside: string;
  readonly sibling: string;
}

async function createFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'brud-workspace-')));
  const workspace = join(base, 'workspace');
  const outside = join(base, 'outside');
  const sibling = join(base, 'workspace-evil');

  await mkdir(join(workspace, 'notes'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await mkdir(sibling, { recursive: true });
  await writeFile(join(workspace, 'notes', 'draft.md'), '# draft\n', 'utf8');
  await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET', 'utf8');
  await writeFile(join(sibling, 'secret.txt'), 'SIBLING-SECRET', 'utf8');

  return { base, workspace, outside, sibling };
}

function ruleOf(error: unknown): string {
  assert.ok(error instanceof WorkspaceViolationError, `expected a WorkspaceViolationError, got ${String(error)}`);

  return error.rule ?? 'UNSPECIFIED';
}

describe('WorkspaceService containment on a real filesystem', () => {
  it('resolves relative and absolute paths inside a canonicalized boot root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();

    assert.equal(service.primaryRoot, await realpath(fixture.workspace));

    const relative = await service.resolve('notes/draft.md');
    const absolute = await service.resolve(join(fixture.workspace, 'notes', 'draft.md'));

    assert.equal(relative.absolutePath, join(service.primaryRoot, 'notes', 'draft.md'));
    assert.equal(relative.relativePath, 'notes/draft.md');
    assert.deepEqual(absolute, relative);
    assert.equal(await service.contains(join(fixture.workspace, 'notes', 'draft.md')), true);
  });

  it('preserves non-existent create targets inside the root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();

    const location = await service.resolve('new/deep/file.txt');

    assert.equal(location.relativePath, 'new/deep/file.txt');
    assert.equal(location.absolutePath, join(service.primaryRoot, 'new', 'deep', 'file.txt'));
  });

  it('rejects absolute paths outside the root and sibling prefixes', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();

    await assert.rejects(service.resolve(join(fixture.outside, 'secret.txt')), (error: unknown) => ruleOf(error) === 'OUTSIDE_ROOT');
    await assert.rejects(service.resolve(join(fixture.sibling, 'secret.txt')), (error: unknown) => ruleOf(error) === 'SIBLING_PREFIX');
    await assert.rejects(service.resolve('../outside/secret.txt'), (error: unknown) => ruleOf(error) === 'TRAVERSAL');
    assert.equal(await service.contains(join(fixture.sibling, 'secret.txt')), false);
  });

  it('rejects a directory symlink that escapes the root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    await symlink(fixture.outside, join(fixture.workspace, 'escape'), 'dir');

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();

    await assert.rejects(service.resolve('escape/secret.txt'), (error: unknown) => ruleOf(error) === 'SYMLINK_ESCAPE');
    await assert.rejects(
      service.resolve(join(fixture.workspace, 'escape', 'secret.txt')),
      (error: unknown) => ruleOf(error) === 'SYMLINK_ESCAPE',
    );
    await assert.rejects(service.resolve('escape/new/deep.txt'), (error: unknown) => ruleOf(error) === 'SYMLINK_ESCAPE');
    assert.equal(await service.contains('escape/secret.txt'), false);
  });

  it('rejects a dangling symlink that would escape on creation', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    await symlink(join(fixture.outside, 'missing'), join(fixture.workspace, 'dangling'), 'file');

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();

    await assert.rejects(service.resolve('dangling/x.txt'), (error: unknown) => ruleOf(error) === 'SYMLINK_ESCAPE');
  });

  it('admits symlinks and hard-equivalent paths that stay inside the root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    await symlink(join(fixture.workspace, 'notes'), join(fixture.workspace, 'alias'), 'dir');
    await symlink(join(fixture.workspace, 'notes', 'draft.md'), join(fixture.workspace, 'draft-link.md'), 'file');

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();

    const viaDirectory = await service.resolve('alias/draft.md');
    const viaFile = await service.resolve('draft-link.md');

    assert.equal(viaDirectory.relativePath, 'notes/draft.md');
    assert.equal(viaFile.relativePath, 'notes/draft.md');
    assert.equal(await service.contains('alias/draft.md'), true);
  });

  it('does not admit a second root through the first root', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const second = join(fixture.base, 'second');
    await mkdir(second, { recursive: true });
    await writeFile(join(second, 'b.md'), 'b', 'utf8');

    const service = new WorkspaceService({
      roots: [fixture.workspace, second],
      primaryRoot: fixture.workspace,
      port,
      flavor: 'posix',
    });
    await service.initialize();

    assert.equal((await service.resolve('notes/draft.md')).root, service.roots[0]);
    await assert.rejects(
      service.resolveInRoot(fixture.workspace, '../second/b.md'),
      (error: unknown) => ruleOf(error) === 'TRAVERSAL',
    );
    await assert.rejects(
      service.resolve(join(second, '..', 'outside', 'secret.txt')),
      (error: unknown) => ruleOf(error) === 'OUTSIDE_ROOT',
    );
  });

  it('keeps batch results identical to unbounded results', async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const service = new WorkspaceService({ roots: [fixture.workspace], port, flavor: 'posix' });
    await service.initialize();
    const batch = service.createBatch();

    const unbounded = await service.resolve(join(fixture.workspace, 'notes', 'draft.md'));
    const cachedFirst = await batch.resolve(join(fixture.workspace, 'notes', 'draft.md'));
    const cachedSecond = await batch.resolve(join(fixture.workspace, 'notes', 'draft.md'));

    assert.deepEqual(cachedFirst, unbounded);
    assert.deepEqual(cachedSecond, unbounded);
    assert.equal(batch.stats.misses, 1);
    assert.equal(batch.stats.hits, 1);
    await assert.rejects(
      batch.resolve(join(fixture.sibling, 'secret.txt')),
      (error: unknown) => ruleOf(error) === 'SIBLING_PREFIX',
    );
  });

  it('canonicalizes a boot root reached through a symlink', symlinkSkip, async (context) => {
    const fixture = await createFixture();
    context.after(async () => {
      await rm(fixture.base, { recursive: true, force: true });
    });

    const linkedRoot = join(fixture.base, 'linked-root');
    await symlink(fixture.workspace, linkedRoot, 'dir');

    const service = new WorkspaceService({ roots: [linkedRoot], port, flavor: 'posix' });
    await service.initialize();

    assert.equal(service.primaryRoot, await realpath(fixture.workspace));
    assert.equal((await service.resolve('notes/draft.md')).relativePath, 'notes/draft.md');
    assert.equal((await service.resolve(join(linkedRoot, 'notes', 'draft.md'))).relativePath, 'notes/draft.md');
  });
});
