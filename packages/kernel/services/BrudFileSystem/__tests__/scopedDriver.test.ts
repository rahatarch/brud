import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'brud-scoped-driver-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

class DurableRecordingDriver extends DurableNodeStorageDriver {
  public readonly calls: string[] = [];

  public failSyncFile = false;

  reset(): void {
    this.calls.length = 0;
  }

  override async writeFile(absolutePath: string, data: Uint8Array | string): Promise<void> {
    this.calls.push(`writeFile:${absolutePath}`);
    await super.writeFile(absolutePath, data);
  }

  override async writeFileExclusive(
    absolutePath: string,
    data: Uint8Array | string,
    options?: { readonly mode?: number },
  ): Promise<void> {
    this.calls.push(`writeFile:${absolutePath}`);
    await super.writeFileExclusive(absolutePath, data, options);
  }

  override async rename(sourcePath: string, targetPath: string): Promise<void> {
    this.calls.push(`rename:${sourcePath}->${targetPath}`);
    await super.rename(sourcePath, targetPath);
  }

  override async deleteFile(absolutePath: string): Promise<void> {
    this.calls.push(`deleteFile:${absolutePath}`);
    await super.deleteFile(absolutePath);
  }

  override async mkdir(
    absoluteDirectoryPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    this.calls.push(`mkdir:${absoluteDirectoryPath}`);
    await super.mkdir(absoluteDirectoryPath, options);
  }

  override async syncFile(absolutePath: string): Promise<void> {
    this.calls.push(`syncFile:${absolutePath}`);

    if (this.failSyncFile) {
      throw new Error('syncFile unavailable');
    }

    await super.syncFile(absolutePath);
  }

  override async syncDirectory(absoluteDirectoryPath: string): Promise<void> {
    this.calls.push(`syncDirectory:${absoluteDirectoryPath}`);
    await super.syncDirectory(absoluteDirectoryPath);
  }
}

async function createHarness(): Promise<{
  service: BrudFileSystem;
  driver: DurableRecordingDriver;
}> {
  const driver = new DurableRecordingDriver();
  const service = new BrudFileSystem(root, driver);

  await service.initialize();
  driver.reset();

  return { service, driver };
}

function sortEntries<T extends { name: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

describe('BrudFileSystem scoped storage driver', () => {
  it('stages, flushes, renames, and flushes the containing directory for writes', async () => {
    const { service, driver } = await createHarness();

    await service.writeAtomic('reports/summary.txt', 'payload');

    const [mkdirCall, writeCall, syncCall, renameCall, syncDirectoryCall] = driver.calls;

    assert.equal(mkdirCall, `mkdir:${root}/reports`);
    assert.match(writeCall ?? '', new RegExp(`^writeFile:${root}/reports/\\.summary\\.txt\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`, 'u'));
    const temporaryPath = (writeCall ?? '').slice('writeFile:'.length);
    assert.equal(syncCall, `syncFile:${temporaryPath}`);
    assert.equal(renameCall, `rename:${temporaryPath}->${root}/reports/summary.txt`);
    assert.equal(syncDirectoryCall, `syncDirectory:${root}/reports`);
    assert.equal(driver.calls.length, 5);
    assert.equal(await service.readText('reports/summary.txt'), 'payload');
    assert.equal(await driver.exists(temporaryPath), false);
  });

  it('routes createFile through the same staged path instead of writing the target directly', async () => {
    const { service, driver } = await createHarness();

    await service.createFile('created.txt', 'fresh');

    const [mkdirCall, writeCall, syncCall, renameCall, syncDirectoryCall] = driver.calls;

    assert.equal(mkdirCall, `mkdir:${root}`);
    assert.match(writeCall ?? '', new RegExp(`^writeFile:${root}/\\.created\\.txt\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`, 'u'));
    const temporaryPath = (writeCall ?? '').slice('writeFile:'.length);
    assert.equal(syncCall, `syncFile:${temporaryPath}`);
    assert.equal(renameCall, `rename:${temporaryPath}->${root}/created.txt`);
    assert.equal(syncDirectoryCall, `syncDirectory:${root}`);
    assert.equal(driver.calls.length, 5);
    assert.equal(driver.calls.includes(`writeFile:${root}/created.txt`), false);
  });

  it('flushes the containing directory after a delete', async () => {
    const { service, driver } = await createHarness();

    await driver.mkdir(`${root}/reports`, { recursive: true });
    await driver.writeFile(`${root}/reports/old.txt`, 'old');
    driver.reset();

    await service.deleteFile('reports/old.txt');

    assert.deepEqual(driver.calls, [
      `deleteFile:${root}/reports/old.txt`,
      `syncDirectory:${root}/reports`,
    ]);
    assert.equal(await service.exists('reports/old.txt'), false);
  });

  it('keeps the previous bytes and removes staging when a flush fails', async () => {
    const { service, driver } = await createHarness();

    await service.writeAtomic('stable.txt', 'original');
    driver.failSyncFile = true;
    driver.reset();

    await assert.rejects(service.writeAtomic('stable.txt', 'replacement'), /syncFile unavailable/);

    driver.failSyncFile = false;
    assert.equal(await service.readText('stable.txt'), 'original');
    assert.deepEqual(sortEntries(await driver.readDir(root)), [
      { name: 'stable.txt', isFile: true, isDirectory: false },
    ]);
  });

  it('degrades to atomic staging when the driver has no flush capability', async () => {
    const driver = new NodeStorageDriver();
    const service = new BrudFileSystem(root, driver);

    await service.initialize();
    await service.writeAtomic('plain.txt', 'plain');

    assert.equal(await service.readText('plain.txt'), 'plain');
    assert.deepEqual(sortEntries(await driver.readDir(root)), [
      { name: 'plain.txt', isFile: true, isDirectory: false },
    ]);
  });
});