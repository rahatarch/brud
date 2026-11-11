import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-protected-paths-')));
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

  it('rejects history reads and writes through the workspace boundary', async () => {
    const { service, driver } = await createService();

    await assert.rejects(service.writeAtomic('.brud/history/seq.json', '{}'), isProtected);
    await mkdir(join(root, '.brud', 'history'), { recursive: true });
    await driver.writeFile(join(root, '.brud/history/seq.json'), '{"date":"20260101","sequence":1}');

    // Reads of the ledger are denied through the workspace boundary even when
    // the file exists; only the storage driver used by the history subsystem
    // may read it.
    await assert.rejects(service.readText('.brud/history/seq.json'), isProtected);
    assert.equal(
      await driver.readText(join(root, '.brud/history/seq.json')),
      '{"date":"20260101","sequence":1}',
    );

    // A trusted write scope no longer bypasses the workspace authority for the
    // static A10 list; the history subsystem writes through the driver.
    const history = service.createAuthorizedProjection(['.brud/history']);

    await assert.rejects(
      history.writeAtomic('.brud/history/seq.json', '{"date":"20260102","sequence":2}'),
      isProtected,
    );
  });

  it('enforces the denylist in the scoped partition facade', async () => {
    const { service } = await createService();
    const facade = new ScopedPartitionFacade(service, '.git');

    await assert.rejects(facade.writeAtomic('hooks/pre-commit', '#!/bin/sh\n'), isProtected);
  });

  it('grants no write scope that can bypass the static A10 denylist', async () => {
    // Since D-15 U-7 history writes through the storage driver, so no caller,
    // the history service included, may write .brud/history by default. The
    // workspace authority enforces A10 before any authorized-scope check runs.
    const descriptor = createFileSystemDescriptor({ driver: new DurableNodeStorageDriver() });
    const scoped = createFileSystemDescriptor({
      driver: new DurableNodeStorageDriver(),
      authorizedWriteScopesByCaller: { 'acme.owner': ['.brud/history'] },
    });
    const instance = new BrudFileSystem(root, new DurableNodeStorageDriver());

    await instance.initialize();

    const coreCaller: ServiceContext = {
      callerId: 'some.core.service',
      tier: 'core',
      options: { workspaceRoot: root },
    };
    const historyCaller: ServiceContext = {
      callerId: 'brud.core.universalHistory',
      tier: 'core',
      options: { workspaceRoot: root },
    };

    assert.ok(descriptor.project);
    const coreProjection = descriptor.project(instance, coreCaller);
    const historyProjection = descriptor.project(instance, historyCaller);

    await assert.rejects(coreProjection.writeAtomic('.brud/history/seq.json', '{}'), isProtected);
    await assert.rejects(historyProjection.writeAtomic('.brud/history/seq.json', '{}'), isProtected);

    assert.ok(scoped.project);
    const owner = scoped.project(instance, { ...coreCaller, callerId: 'acme.owner' });
    await assert.rejects(scoped.project(instance, historyCaller).writeAtomic('.brud/history/seq.json', '{}'), isProtected);
    await assert.rejects(owner.writeAtomic('.brud/history/seq.json', '{}'), isProtected);
  });

  it('silently omits protected and user-ignored entries from directory listings', async () => {
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, '.brud', 'history'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, '.brudignore'), 'node_modules/\ndist/\n', 'utf8');
    await writeFile(join(root, '.brud', 'settings.json'), '{}', 'utf8');
    await writeFile(join(root, 'seed.txt'), 'seed', 'utf8');
    await writeFile(join(root, 'src', 'main.ts'), 'export {};\n', 'utf8');

    const { service } = await createService();
    const names = (await service.readDirectory('')).map((entry) => entry.name).sort();

    assert.equal(names.includes('.git'), false, '.git must be omitted');
    assert.equal(names.includes('.brudignore'), false, '.brudignore must be omitted');
    assert.equal(names.includes('node_modules'), false, 'user-ignored directory must be omitted');
    assert.equal(names.includes('dist'), false, 'user-ignored directory must be omitted');
    assert.equal(names.includes('seed.txt'), true);
    assert.equal(names.includes('src'), true);

    assert.deepEqual(await service.readDirectory('.brud'), []);
  });

  it('projects kernel and userland callers away from the raw writable handle', async () => {
    const descriptor = createFileSystemDescriptor();
    const instance = new BrudFileSystem(root, new DurableNodeStorageDriver());

    await instance.initialize();

    assert.ok(descriptor.project);
    const kernelProjection = descriptor.project(instance, {
      callerId: 'kernel.host',
      tier: 'kernel',
      options: { workspaceRoot: root },
    });
    const userlandProjection = descriptor.project(instance, {
      callerId: 'plugin.demo',
      tier: 'userland',
      options: { workspaceRoot: root },
    });

    assert.notEqual(kernelProjection, instance);
    assert.notEqual(userlandProjection, instance);
    await assert.rejects(kernelProjection.writeAtomic('anything.txt', 'blocked'));
    await assert.rejects(userlandProjection.writeAtomic('anything.txt', 'blocked'));
  });
});