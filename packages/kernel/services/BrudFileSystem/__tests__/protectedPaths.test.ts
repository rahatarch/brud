import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import { createFileSystemDescriptor } from '../descriptor/descriptor.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-protected-paths-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function isProtected(error: unknown): boolean {
  return error instanceof WorkspaceViolationError
    && error.code === 'WORKSPACE_PATH_VIOLATION'
    && error.rule === 'PROTECTED_PATH_DENIED';
}

async function createService(): Promise<{
  service: BrudFileSystem;
  driver: DurableNodeStorageDriver;
}> {
  const driver = new DurableNodeStorageDriver();
  const service = new BrudFileSystem(root, driver);

  await service.initialize();

  return { service, driver };
}

describe('A10 protected-path denylist (V-9)', () => {
  it('rejects writes and deletes under .git', async () => {
    const { service } = await createService();

    await assert.rejects(service.writeAtomic('.git/hooks/pre-commit', '#!/bin/sh\n'), isProtected);
    await assert.rejects(service.createFile('.git/config', '[core]\n'), isProtected);
    await assert.rejects(service.deleteFile('.git/config'), isProtected);
  });

  it('rejects workspace settings writes', async () => {
    const { service } = await createService();

    await assert.rejects(service.writeAtomic('.brud/settings.json', '{}'), isProtected);
    await assert.rejects(service.createFile('.brud/settings.json', '{}'), isProtected);
  });

  it('rejects direct history writes unless the history capability is held', async () => {
    const { service } = await createService();

    await assert.rejects(service.writeAtomic('.brud/history/seq.json', '{}'), isProtected);

    const history = service.createTrustedProjection(['.brud/history']);

    await history.writeAtomic('.brud/history/seq.json', '{"date":"20260101","sequence":1}');
    assert.equal(
      await service.readText('.brud/history/seq.json'),
      '{"date":"20260101","sequence":1}',
    );
  });

  it('enforces the denylist in the scoped partition facade', async () => {
    const { service } = await createService();
    const facade = new ScopedPartitionFacade(service, '.git');

    await assert.rejects(facade.writeAtomic('hooks/pre-commit', '#!/bin/sh\n'), isProtected);
  });

  it('grants no default write scope, and an explicit scope only to its caller', async () => {
    // Since D-15 U-7 history writes through the storage driver, so no caller,
    // the history service included, may write .brud/history by default.
    const descriptor = createFileSystemDescriptor({ driver: new DurableNodeStorageDriver() });
    const scoped = createFileSystemDescriptor({
      driver: new DurableNodeStorageDriver(),
      trustedWriteScopesByCaller: { 'acme.owner': ['.brud/history'] },
    });
    const instance = new BrudFileSystem(root, new DurableNodeStorageDriver());

    await instance.initialize();

    const coreCaller: ServiceContext = {
      callerId: 'some.core.service',
      tier: 'core',
      workspaceRoot: root,
    };
    const historyCaller: ServiceContext = {
      callerId: 'brud.core.universalHistory',
      tier: 'core',
      workspaceRoot: root,
    };

    assert.ok(descriptor.project);
    const coreProjection = descriptor.project(instance, coreCaller);
    const historyProjection = descriptor.project(instance, historyCaller);

    await assert.rejects(coreProjection.writeAtomic('.brud/history/seq.json', '{}'), isProtected);
    await assert.rejects(historyProjection.writeAtomic('.brud/history/seq.json', '{}'), isProtected);

    assert.ok(scoped.project);
    const owner = scoped.project(instance, { ...coreCaller, callerId: 'acme.owner' });
    await assert.rejects(scoped.project(instance, historyCaller).writeAtomic('.brud/history/seq.json', '{}'), isProtected);
    await owner.writeAtomic('.brud/history/seq.json', '{}');
  });

  it('projects kernel and userland callers away from the raw writable handle', async () => {
    const descriptor = createFileSystemDescriptor();
    const instance = new BrudFileSystem(root, new DurableNodeStorageDriver());

    await instance.initialize();

    assert.ok(descriptor.project);
    const kernelProjection = descriptor.project(instance, {
      callerId: 'kernel.host',
      tier: 'kernel',
      workspaceRoot: root,
    });
    const userlandProjection = descriptor.project(instance, {
      callerId: 'plugin.demo',
      tier: 'userland',
      workspaceRoot: root,
    });

    assert.notEqual(kernelProjection, instance);
    assert.notEqual(userlandProjection, instance);
    await assert.rejects(kernelProjection.writeAtomic('anything.txt', 'blocked'));
    await assert.rejects(userlandProjection.writeAtomic('anything.txt', 'blocked'));
  });
});