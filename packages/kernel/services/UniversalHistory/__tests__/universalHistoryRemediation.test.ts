import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import type { KernelLogger, ServiceContext } from '../../../src/contracts/lifecycle.js';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import { BrudFileSystem } from '../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../BrudFileSystem/events/FileMutationJournal.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import { JournalSubscriber } from '../listener/JournalSubscriber.js';
import {
  HISTORY_BLOB_DIR_RELATIVE_PATH,
  HISTORY_DB_RELATIVE_PATH,
} from '../descriptor/HistoryDescriptor.js';
import { HistoryToken } from '../descriptor/tokens.js';
import { UniversalHistory } from '../orchestrator/UniversalHistory.js';
import {
  BlobIntegrityError,
  HistoryDegradedError,
  InvalidHistoryPathError,
  SqliteHistoryStorage,
} from '../storage/SqliteHistoryStorage.js';
import { sha256Hex } from '../storage/hash.js';

const WORKSPACE_ROOT = '/workspace';
const LARGE_PAYLOAD_BYTES = 70 * 1024;

interface Harness {
  readonly history: UniversalHistory;
  readonly fileSystem: BrudFileSystem;
  readonly storage: SqliteHistoryStorage;
  readonly dbPath: string;
  readonly blobDir: string;
}

async function createTempRoot(context: TestContext, prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

async function createHarness(
  context: TestContext,
  options?: { readonly dbPath?: string; readonly blobDir?: string },
): Promise<Harness> {
  const root = await createTempRoot(context, 'brud-history-remediation-');
  const dbPath = options?.dbPath ?? join(root, HISTORY_DB_RELATIVE_PATH);
  const blobDir = options?.blobDir ?? join(root, HISTORY_BLOB_DIR_RELATIVE_PATH);
  const driver = new InMemoryStorageDriver();
  const journal = createFileMutationJournal();
  const fileSystem = new BrudFileSystem(WORKSPACE_ROOT, driver, {
    mutationJournal: journal,
    trustedWriteScopes: ['.brud/history'],
  });

  await fileSystem.initialize();

  const storage = new SqliteHistoryStorage({ dbPath, blobDir });
  const history = new UniversalHistory({ storage, fileSystem, journal });

  context.after(async () => {
    await history.dispose();
  });

  return { history, fileSystem, storage, dbPath, blobDir };
}

function caller(workspaceRoot: string): ServiceContext {
  return { callerId: 'test.history', tier: 'core', workspaceRoot };
}

function largePayload(seed: string): string {
  return `${seed}:${'x'.repeat(LARGE_PAYLOAD_BYTES)}`;
}

describe('F1: blob digest re-verification on reads', () => {
  it('aborts undo when the pre-image blob no longer matches its digest', async (context) => {
    const { history, fileSystem, storage, blobDir } = await createHarness(context);
    const target = 'assets/large.bin';
    const original = largePayload('original');
    const updated = largePayload('updated');
    const originalHash = sha256Hex(original);

    await history.beginSession('session-blob-integrity');
    await fileSystem.writeAtomic(target, original);

    // Mirror the journal's pre-image capture deterministically.
    await storage.putContent(originalHash, Buffer.from(original));
    await fileSystem.writeAtomic(target, updated);

    const entries = await history.getHistory({ targetPath: target });
    assert.equal(entries.length, 2);

    const blobPath = join(blobDir, originalHash);
    assert.equal(existsSync(blobPath), true);

    const cursorBefore = storage.getCursor();

    // Tamper with the historical pre-image without changing its name.
    await writeFile(blobPath, Buffer.from('tampered historical payload'));

    await assert.rejects(
      storage.getContent(originalHash),
      (error: unknown) => error instanceof BlobIntegrityError
        && error.code === 'BLOB_DIGEST_MISMATCH'
        && error.expectedHash === originalHash
        && error.actualHash !== originalHash,
    );

    const report = await history.undo();

    assert.equal(report.status, 'payload_corrupt');
    assert.deepEqual(report.restoredPaths, []);
    assert.deepEqual(report.corruptedPaths, [target]);
    assert.deepEqual(report.detectedDrift, []);

    // The corrupt payload was never replayed and the cursor never moved.
    assert.equal(await fileSystem.readText(target), updated);
    assert.equal(storage.getCursor(), cursorBefore);
  });
});

describe('F2: all-or-nothing payload pre-flight', () => {
  it('writes nothing and freezes the cursor when one pre-image blob is missing', async (context) => {
    const { history, fileSystem, storage, blobDir } = await createHarness(context);
    const targets = ['batch/one.txt', 'batch/two.txt', 'batch/three.txt'];
    const baselines = new Map<string, string>();
    const revisions = new Map<string, string>();

    await history.beginSession('session-atomic-batch');

    for (const target of targets) {
      const baseline = largePayload(`baseline-${target}`);

      baselines.set(target, baseline);
      await fileSystem.writeAtomic(target, baseline);
      await storage.putContent(sha256Hex(baseline), Buffer.from(baseline));
    }

    const checkpointId = await history.recordCheckpoint('before batch revisions');

    for (const target of targets) {
      const revision = largePayload(`revision-${target}`);

      revisions.set(target, revision);
      await fileSystem.writeAtomic(target, revision);
    }

    // Flush ingestion so the redo entries and their snapshots are durable.
    assert.equal(
      (await history.getHistory({ operationKind: 'write' })).length,
      targets.length * 2,
    );

    const missingTarget = targets[1] as string;
    const missingHash = sha256Hex(baselines.get(missingTarget) as string);
    const missingBlob = join(blobDir, missingHash);

    assert.equal(existsSync(missingBlob), true);
    await rm(missingBlob, { force: true });

    const cursorBefore = storage.getCursor();
    const report = await history.rollbackToCheckpoint(checkpointId);

    assert.equal(report.status, 'payload_missing');
    assert.notEqual(report.status, 'partial');
    assert.deepEqual(report.restoredPaths, []);
    assert.deepEqual(report.corruptedPaths, []);
    assert.deepEqual(report.skippedPaths, [missingTarget]);

    // Zero disk writes across the whole batch.
    for (const target of targets) {
      assert.equal(await fileSystem.readText(target), revisions.get(target));
    }

    // The batch stays inside historical reach.
    assert.equal(storage.getCursor(), cursorBefore);
  });
});

describe('F3/F4: multi-process transactions and cursor invariants', () => {
  it('serializes concurrent writers without lock failures and keeps cursor == max(seq)', async (context) => {
    const root = await createTempRoot(context, 'brud-history-multiprocess-');
    const dbPath = join(root, 'history.db');
    const workerPath = join(root, 'history-worker.mjs');
    const storageModuleUrl = new URL(
      '../storage/SqliteHistoryStorage.ts',
      import.meta.url,
    ).href;

    await writeFile(
      workerPath,
      `import { createHash } from 'node:crypto';

const { SqliteHistoryStorage } = await import(process.env.BRUD_HISTORY_STORAGE_URL);

const [dbPath, workerId, countText, delayText] = process.argv.slice(2);
const count = Number(countText);
const delay = Number(delayText);

await new Promise((resolve) => setTimeout(resolve, delay));

const storage = new SqliteHistoryStorage({ dbPath });

for (let index = 0; index < count; index += 1) {
  const payload = Buffer.from(\`payload-\${workerId}-\${index}\\n\`, 'utf8');

  await storage.recordMutation({
    mutationId: \`mp-\${workerId}-\${index}\`,
    sessionId: 'multi-process',
    timestamp: Date.now() + index,
    targetPath: \`workers/\${workerId}-\${index}.txt\`,
    operationKind: 'write',
    previousHash: '',
    updatedHash: createHash('sha256').update(payload).digest('hex'),
    content: payload,
  });
}

storage.close();
`,
      'utf8',
    );

    const workers = ['alpha', 'beta', 'gamma', 'delta'];
    const perWorker = 6;

    const results = await Promise.all(
      workers.map((workerId, index) => runWorker(
        workerPath,
        dbPath,
        storageModuleUrl,
        workerId,
        perWorker,
        index * 25,
      )),
    );

    for (const result of results) {
      assert.equal(result.code, 0, `${result.workerId} failed: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /database is locked|SQLITE_BUSY/u);
    }

    const storage = new SqliteHistoryStorage({ dbPath });

    try {
      const rows = storage.listMutations({ limit: 10_000 });
      const expectedTotal = workers.length * perWorker;

      assert.equal(rows.length, expectedTotal);

      const sequences = rows.map((row) => row.seq).sort((left, right) => left - right);

      assert.deepEqual(
        sequences,
        Array.from({ length: expectedTotal }, (_, index) => index + 1),
      );
      assert.equal(storage.maxSequence(), expectedTotal);
      assert.equal(storage.getCursor(), expectedTotal);
    } finally {
      storage.close();
    }
  });
});

interface WorkerResult {
  readonly workerId: string;
  readonly code: number | null;
  readonly stderr: string;
}

function runWorker(
  workerPath: string,
  dbPath: string,
  storageModuleUrl: string,
  workerId: string,
  count: number,
  delay: number,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', workerPath, dbPath, workerId, String(count), String(delay)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BRUD_HISTORY_STORAGE_URL: storageModuleUrl,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );

    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ workerId, code, stderr });
    });
  });
}

describe('F5: ingestion failure telemetry', () => {
  it('forwards background ingestion failures to the error sink', async (context) => {
    const journal = createFileMutationJournal();
    const storage = new SqliteHistoryStorage({ dbPath: ':memory:' });
    const errors: unknown[] = [];
    const subscriber = new JournalSubscriber({
      journal,
      storage,
      fileSystem: (): IBrudFileSystem => {
        throw new Error('filesystem must not be resolved for this event');
      },
      getSessionId: () => 'session-telemetry',
      onError: (error) => {
        errors.push(error);
      },
    });

    subscriber.start();

    context.after(async () => {
      await subscriber.stop();
      storage.close();
    });

    journal.publish({
      mutationId: 'telemetry-unlink',
      operation: 'unlink',
      phase: 'after',
      path: '/absolute/outside-workspace.txt',
      previous: {
        exists: true,
        kind: 'file',
        size: 1,
        sha256: sha256Hex('x'),
      },
      updated: { exists: false, kind: 'missing', size: 0, sha256: null },
      timestamp: Date.now(),
      committed: true,
    });

    await subscriber.flush();

    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof InvalidHistoryPathError);
  });
});

describe('F6: degraded boot on read-only history storage', () => {
  it('boots the kernel, no-ops ingestion, and rejects reversals', async (context) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      context.skip('filesystem permissions are not enforced for uid 0');
      return;
    }

    const workspaceRoot = await createTempRoot(context, 'brud-history-readonly-');
    const historyDir = join(workspaceRoot, '.brud', 'history');

    await mkdir(historyDir, { recursive: true });
    await chmod(historyDir, 0o555);

    context.after(async () => {
      await chmod(historyDir, 0o755).catch(() => undefined);
    });

    const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const logger: KernelLogger = {
      warn: (message, meta) => {
        warnings.push({ message, ...(meta === undefined ? {} : { meta }) });
      },
    };

    // Legacy-engine test (pinned since D-15 U-6; removed with the legacy engine in U-7).
    const kernel = createStandardKernel({
      historyEngine: 'legacy',
      history: { inMemory: true },
      historyJournal: {},
      logger,
    });

    await kernel.boot({ workspaceRoot });

    try {
      const history = kernel.requestAccess(caller(workspaceRoot), HistoryToken);
      const writer = kernel.requestAccess(caller(workspaceRoot), FileSystemToken);

      assert.deepEqual(await history.getHistory(), []);

      await history.beginSession('degraded-session');
      await writer.writeAtomic('src/degraded.txt', 'payload\n');

      // Ingestion is a safe no-op rather than a thrown error.
      assert.deepEqual(await history.getHistory(), []);

      await assert.rejects(
        history.undo(),
        (error: unknown) => error instanceof HistoryDegradedError
          && error.code === 'HISTORY_DEGRADED'
          && error.reason === 'READ_ONLY_STORAGE',
      );
      await assert.rejects(history.redo(), HistoryDegradedError);
      await assert.rejects(
        history.rollbackToCheckpoint('CP-missing'),
        HistoryDegradedError,
      );

      assert.equal(existsSync(join(historyDir, 'history.db')), false);

      const degradedWarning = warnings.find(
        (warning) => warning.meta?.code === 'HISTORY_DEGRADED',
      );

      assert.ok(degradedWarning !== undefined);
      assert.equal(degradedWarning.meta?.reason, 'READ_ONLY_STORAGE');
    } finally {
      await kernel.shutdown();
    }
  });
});
