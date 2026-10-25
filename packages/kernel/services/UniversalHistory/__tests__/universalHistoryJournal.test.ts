import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../BrudFileSystem/events/FileMutationJournal.js';
import { HISTORY_BLOB_DIR_RELATIVE_PATH } from '../descriptor/HistoryDescriptor.js';
import { UniversalHistory } from '../orchestrator/UniversalHistory.js';
import {
  SqliteHistoryStorage,
  toHistoryRelativePath,
} from '../storage/SqliteHistoryStorage.js';
import { sha256Hex } from '../storage/hash.js';

const WORKSPACE_ROOT = '/workspace';

interface Harness {
  readonly history: UniversalHistory;
  readonly fileSystem: BrudFileSystem;
  readonly storage: SqliteHistoryStorage;
  readonly driver: InMemoryStorageDriver;
}

async function createHarness(
  context: TestContext,
  options?: { readonly dbPath?: string; readonly blobDir?: string },
): Promise<Harness> {
  const driver = new InMemoryStorageDriver();
  const journal = createFileMutationJournal();
  const fileSystem = new BrudFileSystem(WORKSPACE_ROOT, driver, {
    mutationJournal: journal,
    trustedWriteScopes: ['.brud/history'],
  });

  await fileSystem.initialize();

  const storage = new SqliteHistoryStorage({
    dbPath: options?.dbPath ?? ':memory:',
    ...(options?.blobDir === undefined ? {} : { blobDir: options.blobDir }),
  });
  const history = new UniversalHistory({ storage, fileSystem, journal });

  context.after(async () => {
    await history.dispose();
  });

  return { history, fileSystem, storage, driver };
}

async function createTempWorkspace(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-history-journal-'));

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

describe('UniversalHistory deterministic undo and redo', () => {
  it('walks backward and forward through exact historical digests', async (context) => {
    const { history, fileSystem } = await createHarness(context);
    const pathA = 'src/a.txt';
    const pathB = 'src/b.txt';
    const first = 'first version\n';
    const second = 'second version\n';

    await history.beginSession('session-1', { suite: 'undo-redo' });

    await fileSystem.writeAtomic(pathA, first);
    await fileSystem.writeAtomic(pathA, second);
    await fileSystem.createFile(pathB, 'created later\n');
    await fileSystem.deleteFile(pathA);

    const entries = await history.getHistory();
    const reversible = entries.filter((entry) => entry.operationKind !== 'mkdir');

    assert.equal(reversible.length, 4);

    const [unlinkA, createB, overwriteA, createA] = reversible;
    assert.ok(unlinkA);
    assert.ok(createB);
    assert.ok(overwriteA);
    assert.ok(createA);

    assert.equal(unlinkA.targetPath, pathA);
    assert.equal(unlinkA.operationKind, 'unlink');
    assert.equal(unlinkA.previousHash, sha256Hex(second));
    assert.equal(unlinkA.updatedHash, '');

    assert.equal(createB.targetPath, pathB);
    assert.equal(createB.operationKind, 'write');
    assert.equal(createB.previousHash, '');
    assert.equal(createB.updatedHash, sha256Hex('created later\n'));

    assert.equal(overwriteA.previousHash, sha256Hex(first));
    assert.equal(overwriteA.updatedHash, sha256Hex(second));

    assert.equal(createA.previousHash, '');
    assert.equal(createA.updatedHash, sha256Hex(first));

    const restored: string[] = [];

    const undoDelete = await history.undo();
    assert.equal(undoDelete.status, 'success');
    assert.equal(await fileSystem.readText(pathA), second);
    assert.equal(sha256Hex(await fileSystem.readFile(pathA)), sha256Hex(second));
    restored.push(sha256Hex(await fileSystem.readFile(pathA)));

    const undoCreateB = await history.undo();
    assert.equal(undoCreateB.status, 'success');
    assert.equal(await fileSystem.exists(pathB), false);

    const undoOverwrite = await history.undo();
    assert.equal(undoOverwrite.status, 'success');
    assert.equal(await fileSystem.readText(pathA), first);
    assert.equal(sha256Hex(await fileSystem.readFile(pathA)), sha256Hex(first));
    restored.push(sha256Hex(await fileSystem.readFile(pathA)));

    const undoCreateA = await history.undo();
    assert.equal(undoCreateA.status, 'success');
    assert.equal(await fileSystem.exists(pathA), false);

    const exhausted = await history.undo();
    assert.equal(exhausted.status, 'success');
    assert.deepEqual(exhausted.restoredPaths, []);

    const redoCreateA = await history.redo();
    assert.equal(redoCreateA.status, 'success');
    assert.equal(await fileSystem.readText(pathA), first);
    assert.equal(sha256Hex(await fileSystem.readFile(pathA)), sha256Hex(first));

    const redoOverwrite = await history.redo();
    assert.equal(redoOverwrite.status, 'success');
    assert.equal(await fileSystem.readText(pathA), second);
    assert.equal(sha256Hex(await fileSystem.readFile(pathA)), sha256Hex(second));

    const redoCreateB = await history.redo();
    assert.equal(redoCreateB.status, 'success');
    assert.equal(await fileSystem.readText(pathB), 'created later\n');

    const redoDelete = await history.redo();
    assert.equal(redoDelete.status, 'success');
    assert.equal(await fileSystem.exists(pathA), false);

    assert.deepEqual(restored, [sha256Hex(second), sha256Hex(first)]);
  });
});

describe('UniversalHistory external drift detection', () => {
  it('aborts a checkpoint rollback when a file changed outside history', async (context) => {
    const { history, fileSystem, driver } = await createHarness(context);
    const target = 'docs/report.txt';
    const base = 'base content\n';
    const recorded = 'recorded change\n';
    const tampered = 'manual tamper\n';

    await history.beginSession('session-drift');
    await fileSystem.writeAtomic(target, base);

    const checkpointId = await history.recordCheckpoint('before recorded change');
    await fileSystem.writeAtomic(target, recorded);

    await history.getHistory();

    await driver.writeFile(`${WORKSPACE_ROOT}/${target}`, tampered);

    const report = await history.rollbackToCheckpoint(checkpointId);

    assert.equal(report.status, 'drift_aborted');
    assert.deepEqual(report.restoredPaths, []);
    assert.equal(report.detectedDrift.length, 1);
    assert.equal(report.detectedDrift[0]?.path, toHistoryRelativePath(target));
    assert.equal(report.detectedDrift[0]?.expectedHash, sha256Hex(recorded));
    assert.equal(report.detectedDrift[0]?.actualHash, sha256Hex(tampered));
    assert.equal(await fileSystem.readText(target), tampered);
  });
});

describe('UniversalHistory SQLite storage', () => {
  it('runs in WAL mode under rapid concurrent mutations', async (context) => {
    const root = await createTempWorkspace(context);
    const dbPath = join(root, '.brud/history/history.db');
    const { history, fileSystem, storage } = await createHarness(context, { dbPath });

    await history.beginSession('session-concurrent');

    const paths = Array.from({ length: 40 }, (_, index) => `concurrent/file-${index}.txt`);

    await Promise.all(
      paths.map((path, index) => fileSystem.writeAtomic(path, `payload-${index}\n`)),
    );

    const entries = await history.getHistory({ operationKind: 'write' });
    const writes = entries.filter((entry) => entry.targetPath.startsWith('concurrent/'));

    assert.equal(writes.length, paths.length);
    assert.equal(new Set(writes.map((entry) => entry.targetPath)).size, paths.length);
    assert.equal(storage.journalModeValue, 'wal');
    assert.equal(existsSync(dbPath), true);
  });

  it('offloads 500 KB snapshots to content-addressed blobs', async (context) => {
    const root = await createTempWorkspace(context);
    const dbPath = join(root, '.brud/history/history.db');
    const blobDir = join(root, HISTORY_BLOB_DIR_RELATIVE_PATH);
    const { history, fileSystem, storage } = await createHarness(context, {
      dbPath,
      blobDir,
    });
    const payload = 'x'.repeat(500 * 1024);
    const target = 'assets/large.bin';

    await history.beginSession('session-blob');
    await fileSystem.writeAtomic(target, payload);

    const entries = await history.getHistory({ targetPath: target });
    const entry = entries[0];

    assert.ok(entry !== undefined);
    const expectedHash = sha256Hex(payload);

    assert.equal(entry.updatedHash, expectedHash);
    assert.equal(
      entry.blobRef,
      `${HISTORY_BLOB_DIR_RELATIVE_PATH}/${expectedHash}`,
    );
    assert.equal(existsSync(join(blobDir, expectedHash)), true);
    assert.equal(
      (await readFile(join(blobDir, expectedHash), 'utf8')).length,
      payload.length,
    );

    const record = storage.getMutation(entry.mutationId);
    assert.ok(record !== undefined);
    assert.equal(record.inlineData, null);
    assert.equal(record.blobRef, entry.blobRef);

    assert.ok(statSync(dbPath).size < payload.length);
  });
});
