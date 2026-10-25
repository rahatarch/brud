import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import { FileSystemError } from '../operations/shared/errors.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

function isRule(error: unknown, rule: string): boolean {
  return error instanceof WorkspaceViolationError
    && error.code === 'WORKSPACE_PATH_VIOLATION'
    && error.rule === rule;
}

describe('root write rejection (V-3)', () => {
  it('rejects writeAtomic and createFile against the workspace root', async () => {
    const service = new BrudFileSystem('/workspace', new InMemoryStorageDriver());
    await service.initialize();

    await assert.rejects(service.writeAtomic('', 'payload'), (error: unknown) => isRule(error, 'PATH_VIOLATION'));
    await assert.rejects(service.writeAtomic('.', 'payload'), (error: unknown) => isRule(error, 'PATH_VIOLATION'));
    await assert.rejects(service.createFile('', 'payload'), (error: unknown) => isRule(error, 'PATH_VIOLATION'));
    await assert.rejects(service.createFile('.', 'payload'), (error: unknown) => isRule(error, 'PATH_VIOLATION'));
  });

  it('rejects writes targeting an existing directory', async () => {
    const driver = new InMemoryStorageDriver();
    const service = new BrudFileSystem('/workspace', driver);
    await service.initialize();
    await driver.mkdir('/workspace/nested');

    await assert.rejects(
      service.writeAtomic('nested', 'payload'),
      (error: unknown) => error instanceof FileSystemError
        && error.code === 'CANNOT_WRITE_DIRECTORY',
    );
  });
});

describe('metadata preservation (V-10)', () => {
  let root = '';

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'brud-mode-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('preserves an executable mode across an atomic replacement', async () => {
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });

    const scriptPath = join(workspace, 'run.sh');
    await writeFile(scriptPath, '#!/bin/sh\necho old\n');
    await chmod(scriptPath, 0o755);

    const service = new BrudFileSystem(workspace, new DurableNodeStorageDriver());
    await service.initialize();

    await service.writeAtomic('run.sh', '#!/bin/sh\necho new\n');

    const stats = await stat(scriptPath);
    assert.equal(stats.mode & 0o777, 0o755);
  });

  it('defaults new files to safe permissions', async () => {
    const workspace = join(root, 'fresh-workspace');
    await mkdir(workspace, { recursive: true });

    const service = new BrudFileSystem(workspace, new DurableNodeStorageDriver());
    await service.initialize();

    await service.writeAtomic('fresh.txt', 'payload');

    const stats = await stat(join(workspace, 'fresh.txt'));
    assert.equal(stats.mode & 0o777, 0o644);
  });

  it('preserves an in-memory file mode as well', async () => {
    const driver = new InMemoryStorageDriver();
    const service = new BrudFileSystem('/workspace', driver);
    await service.initialize();

    await driver.writeFile('/workspace/tool', 'v1');
    await driver.chmod('/workspace/tool', 0o755);

    await service.writeAtomic('tool', 'v2');

    assert.equal((await service.stat('tool'))?.mode, 0o755);
  });
});
