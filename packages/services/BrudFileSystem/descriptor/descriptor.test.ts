import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import type { ServiceInfo, IKernelAccessBroker } from '@brud/kernel';
import type { ServiceContext } from '@brud/kernel';
import type { ServiceToken } from '@brud/kernel';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade, ReadOnlyViolationError } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { FileSystemDescriptor, createFileSystemDescriptor, createFileSystemHandle } from './descriptor.js';
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
  it('describes a core participant with no token dependencies', () => {
    assert.equal(FileSystemDescriptor.token.id, FileSystemToken.id);
    assert.equal(FileSystemToken.id, 'brud.core.filesystem');
    assert.equal(FileSystemToken.description, 'Centralized atomic filesystem service');
    assert.equal(FileSystemDescriptor.tier, 'core');
    assert.deepEqual(
      FileSystemDescriptor.dependencies.map((token) => token.id),
      [],
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

  describe('exposure handle', () => {
    const caller = (capabilities: readonly string[], identity: string | null = 'acme.holder') => ({
      callerClass: 'participant',
      identity,
      official: false,
      origin: 'runtime',
      capabilities: new Set(capabilities),
    }) as unknown as Parameters<ReturnType<typeof createFileSystemHandle>>[0];

    it('hands a writer the service itself', async () => {
      const instance = await createInstance();

      assert.equal(createFileSystemHandle()(caller(['fs:write']), instance), instance);
    });

    it('hands a reader-only caller a read-only facade', async () => {
      const instance = await createInstance();
      await instance.createFile('shared.txt', 'readable');

      const handle = createFileSystemHandle()(caller(['fs:read']), instance);

      assert.ok(handle instanceof ReadOnlyFacade);
      assert.equal(await handle.readText('shared.txt'), 'readable');
      await assert.rejects(handle.writeAtomic('shared.txt', 'blocked'), isReadOnlyViolation);
      await assert.rejects(handle.createFile('new.txt', 'blocked'), isReadOnlyViolation);
      await assert.rejects(handle.deleteFile('shared.txt'), isReadOnlyViolation);
    });

    it('refuses a caller holding neither capability', async () => {
      const instance = await createInstance();

      assert.equal(createFileSystemHandle()(caller([]), instance), null);
    });

    it('applies an authorized write scope by the caller identity, never by an argument', async () => {
      const instance = await createInstance();
      const handle = createFileSystemHandle({ 'acme.holder': ['.brud/work'] });

      assert.notEqual(handle(caller(['fs:write']), instance), instance);
      assert.equal(handle(caller(['fs:write'], 'acme.other'), instance), instance);
      assert.equal(handle(caller(['fs:write'], null), instance), instance);
    });
  });
});
