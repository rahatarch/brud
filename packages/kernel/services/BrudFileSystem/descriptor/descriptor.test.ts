import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import type { ServiceInfo, IKernelAccessBroker } from '../../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade, ReadOnlyViolationError } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemDescriptor, createFileSystemDescriptor } from './descriptor.js';
import { FileSystemToken } from './tokens.js';

function createCaller(overrides: Partial<ServiceContext>): ServiceContext {
  return {
    callerId: 'test-suite',
    tier: 'core',
    workspaceRoot: '/workspace',
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
  const instance = new BrudFileSystem('/workspace', new InMemoryStorageDriver());
  await instance.initialize();
  return instance;
}

describe('FileSystemDescriptor', () => {
  it('describes a core service with no dependencies', () => {
    assert.equal(FileSystemDescriptor.token, FileSystemToken);
    assert.equal(FileSystemToken.id, 'brud.core.filesystem');
    assert.equal(FileSystemToken.description, 'Centralized atomic filesystem service');
    assert.equal(FileSystemDescriptor.tier, 'core');
    assert.deepEqual(FileSystemDescriptor.dependencies, []);
  });

  it('constructs a BrudFileSystem from the workspace root', async () => {
    const built = FileSystemDescriptor.factory(
      createCaller({ callerId: 'kernel', tier: 'core' }),
      createBroker(),
    );

    assert.ok(built instanceof BrudFileSystem);
    assert.equal(built.workspaceRoot, '/workspace');
    await built.dispose();
  });

  it('binds an explicitly supplied canonical root instead of the context root', async () => {
    const descriptor = createFileSystemDescriptor({
      driver: new InMemoryStorageDriver(),
      root: '/canonical/workspace',
    });

    const built = descriptor.factory(
      createCaller({ callerId: 'kernel', tier: 'core', workspaceRoot: '/linked/workspace' }),
      createBroker(),
    );

    assert.equal(built.workspaceRoot, '/canonical/workspace');
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
      createCaller({ tier: 'core', partitionPrefix: '.brud/history' }),
    );

    assert.ok(projection instanceof ScopedPartitionFacade);
    await projection.createFile('session.json', '{"ok":true}');
    assert.equal(await instance.readText('.brud/history/session.json'), '{"ok":true}');
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
    await instance.createFile('.brud/history/scoped.txt', 'scoped');

    const projection = project(
      instance,
      createCaller({ tier: 'userland', partitionPrefix: '.brud/history' }),
    );

    assert.ok(projection instanceof ReadOnlyFacade);
    assert.equal(await projection.readText('scoped.txt'), 'scoped');
    await assert.rejects(projection.writeAtomic('scoped.txt', 'blocked'), isReadOnlyViolation);
  });
});
