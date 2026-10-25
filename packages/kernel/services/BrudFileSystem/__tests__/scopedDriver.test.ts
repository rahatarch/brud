import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';

const ROOT = '/workspace';

class DurableRecordingDriver extends InMemoryStorageDriver {
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

  async syncFile(absolutePath: string): Promise<void> {
    this.calls.push(`syncFile:${absolutePath}`);

    if (this.failSyncFile) {
      throw new Error('syncFile unavailable');
    }
  }

  async syncDirectory(absoluteDirectoryPath: string): Promise<void> {
    this.calls.push(`syncDirectory:${absoluteDirectoryPath}`);
  }
}

async function createHarness(): Promise<{
  service: BrudFileSystem;
  driver: DurableRecordingDriver;
}> {
  const driver = new DurableRecordingDriver();
  const service = new BrudFileSystem(ROOT, driver);

  await service.initialize();
  driver.reset();

  return { service, driver };
}

describe('BrudFileSystem scoped storage driver', () => {
  it('stages, flushes, renames, and flushes the containing directory for writes', async () => {
    const { service, driver } = await createHarness();

    await service.writeAtomic('reports/summary.txt', 'payload');

    const [mkdirCall, writeCall, syncCall, renameCall, syncDirectoryCall] = driver.calls;

    assert.equal(mkdirCall, `mkdir:${ROOT}/reports`);
    assert.match(writeCall ?? '', new RegExp(`^writeFile:${ROOT}/reports/\\.summary\\.txt\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`, 'u'));
    const temporaryPath = (writeCall ?? '').slice('writeFile:'.length);
    assert.equal(syncCall, `syncFile:${temporaryPath}`);
    assert.equal(renameCall, `rename:${temporaryPath}->${ROOT}/reports/summary.txt`);
    assert.equal(syncDirectoryCall, `syncDirectory:${ROOT}/reports`);
    assert.equal(driver.calls.length, 5);
    assert.equal(await service.readText('reports/summary.txt'), 'payload');
    assert.equal(await driver.exists(temporaryPath), false);
  });

  it('routes createFile through the same staged path instead of writing the target directly', async () => {
    const { service, driver } = await createHarness();

    await service.createFile('created.txt', 'fresh');

    const [mkdirCall, writeCall, syncCall, renameCall, syncDirectoryCall] = driver.calls;

    assert.equal(mkdirCall, `mkdir:${ROOT}`);
    assert.match(writeCall ?? '', new RegExp(`^writeFile:${ROOT}/\\.created\\.txt\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`, 'u'));
    const temporaryPath = (writeCall ?? '').slice('writeFile:'.length);
    assert.equal(syncCall, `syncFile:${temporaryPath}`);
    assert.equal(renameCall, `rename:${temporaryPath}->${ROOT}/created.txt`);
    assert.equal(syncDirectoryCall, `syncDirectory:${ROOT}`);
    assert.equal(driver.calls.length, 5);
    assert.equal(driver.calls.includes(`writeFile:${ROOT}/created.txt`), false);
  });

  it('flushes the containing directory after a delete', async () => {
    const { service, driver } = await createHarness();

    await driver.mkdir(`${ROOT}/reports`, { recursive: true });
    await driver.writeFile(`${ROOT}/reports/old.txt`, 'old');
    driver.reset();

    await service.deleteFile('reports/old.txt');

    assert.deepEqual(driver.calls, [
      `deleteFile:${ROOT}/reports/old.txt`,
      `syncDirectory:${ROOT}/reports`,
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
    assert.deepEqual(await driver.readDir(ROOT), [
      { name: 'stable.txt', isFile: true, isDirectory: false },
    ]);
  });

  it('degrades to atomic staging when the driver has no flush capability', async () => {
    const driver = new InMemoryStorageDriver();
    const service = new BrudFileSystem(ROOT, driver);

    await service.initialize();
    await service.writeAtomic('plain.txt', 'plain');

    assert.equal(await service.readText('plain.txt'), 'plain');
    assert.deepEqual(await driver.readDir(ROOT), [
      { name: 'plain.txt', isFile: true, isDirectory: false },
    ]);
  });
});
