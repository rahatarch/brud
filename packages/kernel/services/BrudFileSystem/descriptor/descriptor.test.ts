import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import type { ServiceInfo, IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade, ReadOnlyViolationError } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemDescriptor, createFileSystemDescriptor } from './descriptor.js';
import { FileSystemToken } from './tokens.js';

let workspaceRoot = '';
let caseCounter = 0;

before(async () => {
  workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'brud-fs-descriptor-')));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function nextRoot(): string {
  caseCounter += 1;
  return join(workspaceRoot, `case-${caseCounter}`);
}

function createCaller(overrides: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'test-suite',
    tier: 'core',
    options: { 'filesystem.root': workspaceRoot },
    ...overrides,
  };
}

function createBroker(): IKernelAccessBroker {
  return {
    requestAccess<TService>(
      _caller: ServiceContext,
      _token: ServiceToken<TService>,
    ): TService {
      throw new Error('requestAccess is not used in this test');
    },
    hasService(_token: ServiceToken<unknown>): boolean {
      return false;
    },
    listServices(): readonly ServiceInfo[] {
      return [];
    },
  };
}

function isReadOnlyViolation(error: unknown): boolean {
  return error instanceof ReadOnlyViolationError && error.code === 'READ_ONLY_VIOLATION';
}

async function createInstance(): Promise<BrudFileSystem> {
  const instance = new BrudFileSystem(nextRoot(), new DurableNodeStorageDriver());
  await instance.initialize();
  return instance;
}

describe('FileSystemDescriptor', () => {
  it('describes a core service depending on the workspace and settings reader', () => {
    assert.equal(FileSystemDescriptor.token, FileSystemToken);
    assert.equal(FileSystemToken.id, 'brud.core.filesystem');
    assert.equal(FileSystemToken.description, 'Centralized atomic filesystem service');
    assert.equal(FileSystemDescriptor.tier, 'core');
    assert.deepEqual(
      FileSystemDescriptor.dependencies.map((token) => token.id),
      ['brud.core.workspace', 'brud.core.settings.reader'],
    );
  });

  it('constructs a BrudFileSystem from the workspace root', async () => {
    const built = FileSystemDescriptor.factory(
      createCaller({ callerId: 'kernel', tier: 'core' }),
      createBroker(),
    );

    assert.ok(built instanceof BrudFileSystem);
    assert.equal(built.workspaceRoot, workspaceRoot);
    await built.dispose();
  });

  it('binds an explicitly supplied canonical root instead of the context root', async () => {
    const canonicalRoot = join(workspaceRoot, 'canonical');
    const descriptor = createFileSystemDescriptor({
      driver: new DurableNodeStorageDriver(),
      root: canonicalRoot,
    });

    const built = descriptor.factory(
      createCaller({ callerId: 'kernel', tier: 'core', options: { 'filesystem.root': join(workspaceRoot, 'linked') } }),
      createBroker(),
    );

    assert.equal(built.workspaceRoot, canonicalRoot);
    await built.dispose();
  });

  it('returns the internal service unchanged for privileged callers', async () => {
    const project = FileSystemDescriptor.project;
    assert.ok(project);
    const instance = await createInstance();

    const projection = project(instance, createCaller({ tier: 'core' }));

    assert.equal(projection, instance);
  });

  it('scopes callers carrying a partition prefix', async () => {
    const project = FileSystemDescriptor.project;
    assert.ok(project);
    const instance = await createInstance();

    const projection = project(
      instance,
      createCaller({ tier: 'core', partitionPrefix: '.brud/work' }),
    );

    assert.ok(projection instanceof ScopedPartitionFacade);
    await projection.createFile('session.json', '{"ok":true}');
    assert.equal(await instance.readText('.brud/work/session.json'), '{"ok":true}');
  });

  it('projects userland callers to a read-only facade', async () => {
    const project = FileSystemDescriptor.project;
    assert.ok(project);
    const instance = await createInstance();
    await instance.createFile('shared.txt', 'readable');

    const projection = project(instance, createCaller({ tier: 'userland' }));

    assert.ok(projection instanceof ReadOnlyFacade);
    assert.equal(await projection.readText('shared.txt'), 'readable');
    await assert.rejects(projection.writeAtomic('shared.txt', 'blocked'), isReadOnlyViolation);
    await assert.rejects(projection.createFile('new.txt', 'blocked'), isReadOnlyViolation);
    await assert.rejects(projection.deleteFile('shared.txt'), isReadOnlyViolation);
  });

  it('composes partition scoping with read-only projection for userland callers', async () => {
    const project = FileSystemDescriptor.project;
    assert.ok(project);
    const instance = await createInstance();
    await instance.createFile('.brud/work/scoped.txt', 'scoped');

    const projection = project(
      instance,
      createCaller({ tier: 'userland', partitionPrefix: '.brud/work' }),
    );

    assert.ok(projection instanceof ReadOnlyFacade);
    assert.equal(await projection.readText('scoped.txt'), 'scoped');
    await assert.rejects(projection.writeAtomic('scoped.txt', 'blocked'), isReadOnlyViolation);
  });
});