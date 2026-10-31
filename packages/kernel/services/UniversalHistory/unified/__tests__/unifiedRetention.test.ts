/**
 * Retention and garbage collection (D-15 U-8, gate G-U8).
 *
 * The clock is injected so ages are exact; blob mtimes are real, and the
 * sweep's clock is moved past them where a test needs an old file.
 */
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { createStandardKernel } from '../../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../../src/contracts/lifecycle.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { FileSystemToken } from '../../../BrudFileSystem/descriptor/tokens.js';
import { InMemoryConfigStore } from '../../../SettingsService/storage/InMemoryConfigStore.js';
import { UniversalHistoryToken } from '../../descriptor/tokens.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import { CORE_NAMESPACE, HISTORY_GC_GRACE_MS, UnifiedHistoryService } from '../service/index.js';
import { UnifiedHistoryStore, blobPath, sha256Hex } from '../store/index.js';

const ROOT = '/workspace';
const DAY = 86_400_000;
const HISTORY = `${ROOT}/.brud/history`;
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

interface Harness {
  readonly clock: { now: number };
  readonly driver: InMemoryStorageDriver;
  readonly fs: BrudFileSystem;
  readonly store: UnifiedHistoryStore;
  readonly service: UnifiedHistoryService;
  readonly engine: ReversalEngine;
}

async function harness(context: TestContext): Promise<Harness> {
  const clock = { now: Date.now() };
  const now = (): number => clock.now;
  const driver = new InMemoryStorageDriver();
  const journal = createFileMutationJournal();
  const fs = new BrudFileSystem(ROOT, driver, { mutationJournal: journal });
  await fs.initialize();
  const store = new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: HISTORY, driver, now });
  const service = new UnifiedHistoryService({ store, fileSystem: () => fs, journal, now });
  await service.start();
  context.after(() => service.dispose());
  const engine = new ReversalEngine({ service, fileSystem: () => fs, now });
  return { clock, driver, fs, store, service, engine };
}

async function write(h: Harness, path: string, text: string): Promise<void> {
  await h.fs.writeAtomic(path, text);
  await h.service.flush();
}

function fileSeqs(h: Harness): number[] {
  return h.store.listEntries({ namespace: CORE_NAMESPACE, type: 'file', order: 'asc', limit: 1000 }).rows.map((row) => row.seq);
}

/** Every digest referenced by a remaining entry must still resolve. */
async function assertNoDanglingContent(h: Harness): Promise<void> {
  for (const row of h.store.listEntries({ order: 'asc', limit: 1000 }).rows) {
    const payload = await h.service.resolvePayload(row) as Record<string, unknown>;
    for (const key of ['preSha256', 'postSha256']) {
      const digest = payload[key];
      if (typeof digest === 'string') {
        const bytes = await h.store.getContent(digest);
        assert.equal(sha256Hex(bytes), digest);
      }
    }
  }
}

describe('history retention (D-15 U-8)', () => {
  it('cuts by age but always keeps the newest undo entries, and undo still works', async (context) => {
    const h = await harness(context);
    for (let index = 1; index <= 6; index += 1) {
      await write(h, 'f.txt', `v${index}\n`);
    }
    h.clock.now += 100 * DAY;
    await write(h, 'g.txt', 'new\n');
    const all = fileSeqs(h);

    const report = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 2 });

    assert.ok(!('skipped' in report));
    assert.equal(report.retention.fileEntriesRemoved, 5);
    assert.deepEqual(fileSeqs(h), all.slice(-2));
    assert.ok(h.store.getCursor() >= Math.min(...fileSeqs(h)) - 1);
    await assertNoDanglingContent(h);

    assert.equal((await h.engine.undo()).status, 'success');
    assert.equal(await h.fs.exists('g.txt'), false);
    assert.equal((await h.engine.undo()).status, 'success');
    assert.equal(await h.fs.readText('f.txt'), 'v5\n');
    assert.equal((await h.engine.undo()).restoredPaths.length, 0);
  });

  it('never removes the redo tail above the undo cursor', async (context) => {
    const h = await harness(context);
    for (let index = 1; index <= 4; index += 1) {
      await write(h, 'a.txt', `a${index}\n`);
    }
    assert.equal((await h.engine.undo(2)).status, 'success');
    const cursor = h.store.getCursor();
    h.clock.now += 100 * DAY;

    await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1 });

    assert.deepEqual(fileSeqs(h).filter((seq) => seq > cursor).length, 2);
    assert.equal(h.store.getCursor(), cursor);
    assert.equal((await h.engine.redo(2)).status, 'success');
    assert.equal(await h.fs.readText('a.txt'), 'a4\n');
  });

  it('keeps active sessions, removes old closed sessions whole, and never splits a session', async (context) => {
    const h = await harness(context);
    const closed = await h.service.beginSession('old closed', { declaredTargets: ['c.txt'] });
    await write(h, 'c.txt', 'c1\n');
    await h.service.commitSession(closed, 'completed');
    await write(h, 'loose.txt', 'implicit\n');
    const active = await h.service.beginSession('still active', { declaredTargets: ['act.txt'] });
    await write(h, 'act.txt', 'a1\n');
    await write(h, 'loose.txt', 'implicit 2\n');
    h.clock.now += 100 * DAY;

    const report = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1 });

    assert.ok(!('skipped' in report));
    assert.equal(h.store.getSession(closed), undefined);
    assert.equal(h.store.getSession(active)?.status, 'active');
    const activeEntries = h.store.listEntries({ sessionId: active, limit: 100 }).rows;
    assert.equal(activeEntries.length, 1);
    // The implicit write before the active session went; the one after stays.
    const loose = h.store.listEntries({ namespace: CORE_NAMESPACE, type: 'file', order: 'asc', limit: 100 }).rows
      .filter((row) => row.sessionId === h.service.implicitSession);
    assert.equal(loose.length, 1);
    assert.ok((loose[0]?.seq ?? 0) > (activeEntries[0]?.seq ?? Infinity));
    await assertNoDanglingContent(h);
  });

  it('keeps a whole old session when the undo floor protects any of its file entries', async (context) => {
    const h = await harness(context);
    await write(h, 'pre.txt', 'implicit\n');
    const session = await h.service.beginSession('straddles the floor', { declaredTargets: ['s1.txt', 's2.txt'] });
    await write(h, 's1.txt', 'one\n');
    await write(h, 's2.txt', 'two\n');
    await h.service.commitSession(session, 'completed');
    h.clock.now += 100 * DAY;

    const report = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1 });

    assert.ok(!('skipped' in report));
    assert.equal(h.store.getSession(session)?.status, 'committed');
    const files = h.store.listEntries({ sessionId: session, namespace: CORE_NAMESPACE, type: 'file', limit: 100 }).rows;
    assert.equal(files.length, 2);
    assert.equal((await h.engine.planSessionReversal(session)).isExecutable, true);
    assert.equal(report.retention.fileEntriesRemoved, 1);
  });

  it('keeps a closed session that is younger than the cutoff even when older history goes', async (context) => {
    const h = await harness(context);
    await write(h, 'x.txt', 'old\n');
    h.clock.now += 100 * DAY;
    const recent = await h.service.beginSession('recent', { declaredTargets: ['y.txt'] });
    await write(h, 'y.txt', 'y\n');
    await h.service.commitSession(recent, 'completed');
    await write(h, 'z.txt', 'z\n');

    await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1 });

    assert.equal(h.store.getSession(recent)?.status, 'committed');
    assert.equal(h.store.listEntries({ sessionId: recent, limit: 100 }).rows.length > 0, true);
    assert.equal(fileSeqs(h).length, 2);
  });

  it('removes checkpoints that would need removed history and keeps valid ones', async (context) => {
    const h = await harness(context);
    await write(h, 'k.txt', 'k1\n');
    const early = await h.engine.recordCheckpoint('early');
    await write(h, 'k.txt', 'k2\n');
    await write(h, 'k.txt', 'k3\n');
    h.clock.now += 100 * DAY;
    await write(h, 'k.txt', 'k4\n');
    const late = await h.engine.recordCheckpoint('late');
    await write(h, 'k.txt', 'k5\n');

    const report = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1 });

    assert.ok(!('skipped' in report));
    assert.equal(report.retention.checkpointsRemoved, 1);
    assert.equal(h.store.getCheckpoint(early), undefined);
    assert.ok(h.store.getCheckpoint(late) !== undefined);
    assert.equal((await h.engine.rollbackToCheckpoint(late)).status, 'success');
    assert.equal(await h.fs.readText('k.txt'), 'k4\n');
  });

  it('respects the per-run budget and finishes on the next run', async (context) => {
    const h = await harness(context);
    for (let index = 1; index <= 10; index += 1) {
      await write(h, 'b.txt', `b${index}\n`);
    }
    h.clock.now += 100 * DAY;
    await write(h, 'b.txt', 'b-new\n');

    const first = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1, maxEntriesPerRun: 4 });
    assert.ok(!('skipped' in first));
    assert.equal(first.retention.fileEntriesRemoved, 4);
    assert.equal(first.retention.truncated, true);
    const second = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 1 });
    assert.ok(!('skipped' in second));
    assert.equal(second.retention.fileEntriesRemoved, 6);
    assert.equal(fileSeqs(h).length, 1);
  });
});

describe('history garbage collection (D-15 U-8)', () => {
  it('removes unreferenced content past the grace period; reuse and references keep it', async (context) => {
    const h = await harness(context);
    const orphan = await h.store.putContent(new TextEncoder().encode('orphan'));
    const reused = await h.store.putContent(new TextEncoder().encode('reused'));
    const large = await h.store.putContent(new Uint8Array(70 * 1024).fill(7));
    await write(h, 'kept.txt', 'kept\n');
    // A large recorded file: its blob is referenced and must survive the sweep.
    await write(h, 'big.txt', 'B'.repeat(70 * 1024));
    h.clock.now += 2 * HISTORY_GC_GRACE_MS;
    await h.store.putContent(new TextEncoder().encode('reused'));
    const young = await h.store.putContent(new TextEncoder().encode('young'));

    const report = await h.service.runRetention({ retentionDays: 90, minUndoEntries: 10_000 });

    assert.ok(!('skipped' in report));
    assert.equal(report.contents.contentsRemoved, 2);
    await assert.rejects(() => h.store.getContent(orphan.sha256));
    await assert.rejects(() => h.store.getContent(large.sha256));
    assert.ok(await h.store.getContent(reused.sha256));
    assert.ok(await h.store.getContent(young.sha256));
    await assertNoDanglingContent(h);
    // The large blob's row went in this run; its file is swept in the same run.
    assert.equal(report.blobs.blobsRemoved, 1);
    assert.equal(await h.driver.exists(blobPath(HISTORY, large.sha256)), false);
  });

  it('sweeps only old orphan blobs and staging files under cas/, never legacy files', async (context) => {
    const h = await harness(context);
    const digest = sha256Hex(new TextEncoder().encode('lost'));
    const orphanPath = blobPath(HISTORY, digest);
    await h.driver.mkdir(join(orphanPath, '..'), { recursive: true });
    await h.driver.writeFile(orphanPath, 'lost');
    const staging = join(orphanPath, '..', `.${digest}.123.abc.tmp`);
    await h.driver.writeFile(staging, 'partial');
    for (const legacy of ['ledger.db', 'history.db', 'seq.json', `blobs/${digest}`]) {
      await h.driver.mkdir(join(HISTORY, legacy, '..'), { recursive: true });
      await h.driver.writeFile(join(HISTORY, legacy), 'legacy');
    }

    const early = await h.store.sweepBlobs({ now: Date.now(), graceMs: HISTORY_GC_GRACE_MS });
    assert.deepEqual([early.blobsRemoved, early.stagingRemoved], [0, 0]);

    const late = await h.store.sweepBlobs({ now: Date.now() + 2 * HISTORY_GC_GRACE_MS, graceMs: HISTORY_GC_GRACE_MS });
    assert.deepEqual([late.blobsRemoved, late.stagingRemoved], [1, 1]);
    assert.equal(await h.driver.exists(orphanPath), false);
    assert.equal(await h.driver.exists(staging), false);
    for (const legacy of ['ledger.db', 'history.db', 'seq.json', `blobs/${digest}`]) {
      assert.equal(await h.driver.readText(join(HISTORY, legacy)), 'legacy', legacy);
    }
  });

  it('skips retention and collection while degraded', async (context) => {
    if (isRoot) {
      context.skip('filesystem permissions are not enforced for uid 0');
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'brud-retention-ro-'));
    const historyRoot = join(root, '.brud', 'history');
    await mkdir(historyRoot, { recursive: true });
    await chmod(historyRoot, 0o555);
    context.after(async () => {
      await chmod(historyRoot, 0o755);
      await rm(root, { recursive: true, force: true });
    });
    const store = new UnifiedHistoryStore({ dbPath: join(historyRoot, 'universal.db'), historyRoot, driver: new DurableNodeStorageDriver() });
    const service = new UnifiedHistoryService({ store, fileSystem: () => { throw new Error('unused'); } });
    await service.start();
    context.after(() => service.dispose());

    assert.equal(service.isDegraded, true);
    assert.deepEqual(await service.runRetention({ retentionDays: 90, minUndoEntries: 1 }), { skipped: 'degraded' });
  });
});

describe('history retention — INV-3 keeps the live implicit session (D-15 A6)', () => {
  it('A6 retention keeps the implicit session this process is recording into, even after it had to be replaced', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-d15-a6-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    const driver = new DurableNodeStorageDriver();
    const journal = createFileMutationJournal();
    const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
    await fs.initialize();

    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver });
    const service = new UnifiedHistoryService({ store, fileSystem: () => fs, journal });
    await service.start();
    context.after(() => service.dispose());

    // A second, empty implicit row that belongs to no live process; it is the
    // row retention is free to reclaim.
    const staleId = store.createSession({ prompt: 'automatic recording', implicit: true, now: Date.now() }).sessionId;

    // Force the accessor to mint a replacement: the row this process booted
    // with stops being active. From here the only id this process may record
    // into is the replacement, so it is the one the keep guard must name.
    const bootId = service.implicitSession as string;
    store.transitionSession(bootId, ['active'], 'committed', Date.now());
    const liveId = service.implicitSessionForRecording() as string;
    assert.notEqual(liveId, bootId, 'the lost row was replaced (F2)');
    assert.equal(store.getSession(liveId)?.status, 'active');
    assert.equal(store.getSession(liveId)?.implicit, true);
    assert.equal(service.implicitSession, liveId, 'the replacement is now the recording session');

    await service.runRetention({ retentionDays: 90, minUndoEntries: 1 });

    // Observable outcome only: the session this process is recording into is
    // still there and still active. Nothing here inspects keepSessionId.
    const live = store.getSession(liveId);
    assert.ok(live, 'retention removed the session this process records into (INV-3 regression)');
    assert.equal(live.status, 'active');
    assert.equal(live.implicit, true);
    assert.equal(store.getSession(staleId), undefined, 'the unowned empty implicit row was reclaimed');
  });
});

describe('history retention at boot through settings (D-15 U-8)', () => {
  it('runs after RUNNING with the frozen settings: a longer user retention keeps what the default removes', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-retention-boot-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const caller: ServiceContext = { callerId: 'test.retention', tier: 'core', workspaceRoot: root };
    const boot = async (user: Record<string, unknown> | null): Promise<ReturnType<typeof createStandardKernel>> => {
      const kernel = createStandardKernel({
        settings: { store: new InMemoryConfigStore({ userContent: user === null ? null : JSON.stringify(user) }) },
      });
      await kernel.boot({ workspaceRoot: root });
      return kernel;
    };

    const first = await boot(null);
    const history = first.requestAccess(caller, UniversalHistoryToken);
    const aborted = await history.beginSession('abandoned long ago', []);
    await history.commitSession(aborted, 'aborted');
    await first.requestAccess(caller, FileSystemToken).writeAtomic('keep.txt', 'kept\n');
    await first.shutdown();

    // Age the aborted session by 100 days.
    const dbPath = join(root, '.brud', 'history', 'universal.db');
    const db = new DatabaseSync(dbPath);
    const old = Date.now() - 100 * DAY;
    db.prepare('UPDATE sessions SET created_at = ?, closed_at = ? WHERE session_id = ?').run(old, old, aborted);
    db.close();

    const kept = await boot({ historyRetentionDays: 365 });
    assert.equal((await kept.requestAccess(caller, UniversalHistoryToken).getSession(aborted))?.status, 'aborted');
    await kept.shutdown();

    const pruned = await boot(null);
    assert.equal(await pruned.requestAccess(caller, UniversalHistoryToken).getSession(aborted), null);
    assert.equal(await pruned.requestAccess(caller, FileSystemToken).readText('keep.txt'), 'kept\n');
    await pruned.shutdown();
    assert.equal(existsSync(dbPath), true);
    assert.ok((await readFile(dbPath)).byteLength > 0);
  });
});

describe('history retention — live-row claims (U-8 corrective, RL)', () => {
  /** A real store over a real database file under `mkdtemp`. */
  async function fileStore(context: TestContext, prefix: string): Promise<{ root: string; dbPath: string; store: UnifiedHistoryStore }> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver: new DurableNodeStorageDriver() });
    await store.open();
    context.after(() => store.close());
    return { root, dbPath, store };
  }

  /** Reads `sessions` on a connection of its own, never through the store. */
  function rawSessions(dbPath: string): { session_id: string; status: string; metadata: string | null }[] {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      return db.prepare('SELECT session_id, status, metadata FROM sessions ORDER BY session_id').all() as unknown as {
        session_id: string; status: string; metadata: string | null;
      }[];
    } finally {
      db.close();
    }
  }

  function claim(pid: number): { readonly pid: number; readonly nonce: string; readonly createdAt: number } {
    return { pid, nonce: 'a'.repeat(32), createdAt: Date.now() };
  }

  /**
   * Number of commit records the write-ahead log currently holds, read from the
   * file itself. Each commit appends one frame whose "database size after
   * commit" field (bytes 4..8 of the frame header) is non-zero; uncommitted
   * frames carry zero there.
   */
  function walCommitFrames(dbPath: string): number {
    let buf: Buffer;
    try {
      buf = readFileSync(`${dbPath}-wal`);
    } catch {
      return 0;
    }
    if (buf.length < 32) {
      return 0;
    }
    const pageSizeRaw = buf.readUInt32BE(8);
    const pageSize = pageSizeRaw === 1 ? 65_536 : pageSizeRaw;
    let frames = 0;
    for (let offset = 32; offset + 24 <= buf.length; offset += 24 + pageSize) {
      if (buf.readUInt32BE(offset + 4) !== 0) {
        frames += 1;
      }
    }
    return frames;
  }

  it('T-2.2: the claim is published by the same INSERT as the row', async (context) => {
    const { dbPath, store } = await fileStore(context, 'brud-rl-t22-');
    const live = store.createSession({
      prompt: 'automatic recording',
      implicit: true,
      metadata: { declaredTargets: ['kept.txt'] },
      now: Date.now(),
      claim: claim(process.pid),
    });
    const [row] = rawSessions(dbPath).filter((candidate) => candidate.session_id === live.sessionId);
    assert.ok(row, 'the row is missing');
    const metadata = JSON.parse(row.metadata ?? '{}') as { brudHistoryClaim?: Record<string, unknown>; declaredTargets?: unknown };
    assert.equal(metadata.brudHistoryClaim?.alive, 1);
    assert.equal(metadata.brudHistoryClaim?.releasedAt, null);
    assert.deepEqual(metadata.declaredTargets, ['kept.txt']);
  });

  it('T-2.2-b: while the insert waits on another writer no reader can observe the row', async (context) => {
    const { root, dbPath } = await fileStore(context, 'brud-rl-t22b-');
    const historyRoot = join(root, '.brud', 'history');
    // A second process holds the write lock; the inserting store waits on it.
    const holder = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      [
        "import { DatabaseSync } from 'node:sqlite';",
        'const db = new DatabaseSync(process.argv[1]);',
        "db.exec('PRAGMA busy_timeout = 5000');",
        "db.exec('BEGIN IMMEDIATE');",
        "process.stdout.write('held');",
        'await new Promise((resolve) => setTimeout(resolve, 250));',
        "db.exec('COMMIT');",
        'db.close();',
      ].join('\n'),
      dbPath,
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    context.after(() => { holder.kill('SIGKILL'); });
    await new Promise<void>((resolve) => { holder.stdout.once('data', () => { resolve(); }); });

    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver: new DurableNodeStorageDriver() });
    context.after(() => store.close());
    await store.open();

    // Reads taken while the insert is blocked: either the row is absent, or it
    // is present together with its claim. A row without a claim is the window
    // this design must not have.
    const sightings: (string | null)[] = [];
    const poll = setInterval(() => {
      const [row] = rawSessions(dbPath);
      sightings.push(row === undefined ? null : (JSON.parse(row.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number } }).brudHistoryClaim?.alive === 1 ? 'claimed' : 'unclaimed');
    }, 10);
    const inserted = store.createSession({ prompt: 'automatic recording', implicit: true, now: Date.now(), claim: claim(process.pid) });
    clearInterval(poll);
    await new Promise<void>((resolve) => { holder.on('close', () => { resolve(); }); });

    assert.equal(sightings.includes('unclaimed'), false, `a reader saw an unclaimed row: ${JSON.stringify(sightings)}`);
    const rows = rawSessions(dbPath);
    assert.deepEqual(rows.map((row) => row.session_id), [inserted.sessionId]);
    const metadata = JSON.parse(rows[0]?.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number } };
    assert.equal(metadata.brudHistoryClaim?.alive, 1);
  });

  it('T-2.3: dispose and rotation release the claim on the row itself', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-rl-t23-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    const driver = new DurableNodeStorageDriver();
    const journal = createFileMutationJournal();
    const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
    await fs.initialize();
    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver });
    const service = new UnifiedHistoryService({ store, fileSystem: () => fs, journal });
    await service.start();

    const boot = service.implicitSession as string;
    service.openRecordingSession('rotation');
    const rotated = service.implicitSession as string;
    assert.notEqual(rotated, boot);
    const afterRotation = rawSessions(dbPath);
    const previous = JSON.parse(afterRotation.find((row) => row.session_id === boot)?.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number; releasedAt?: number | null; releasedBy?: string } };
    const current = JSON.parse(afterRotation.find((row) => row.session_id === rotated)?.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number; releasedAt?: number | null } };
    assert.equal(previous.brudHistoryClaim?.alive, 0, 'the rotated-out row kept its claim');
    assert.equal(previous.brudHistoryClaim?.releasedBy, 'close');
    assert.ok(typeof previous.brudHistoryClaim?.releasedAt === 'number');
    assert.equal(current.brudHistoryClaim?.alive, 1);
    assert.equal(current.brudHistoryClaim?.releasedAt, null);

    await service.dispose();
    const afterDispose = rawSessions(dbPath);
    for (const row of afterDispose) {
      const metadata = JSON.parse(row.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number } };
      assert.equal(metadata.brudHistoryClaim?.alive ?? 0, 0, `${row.session_id} still claims to be live`);
    }
  });

  it('T-2.4: a SIGKILLed owner\'s claim is released and its row reclaimed on the next boot', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-rl-t24-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    // A real process that boots a kernel, leaves an unclaimed-entry row behind,
    // and is killed without disposing.
    const script = `
const { createStandardKernel } = await import(${JSON.stringify(new URL('../../../../src/bootstrap/index.ts', import.meta.url).href)});
const kernel = createStandardKernel();
await kernel.boot({ workspaceRoot: process.argv[2] });
process.stdout.write('ready');
await new Promise(() => {});
`;
    const scriptPath = join(root, '..', `retention-live-row-crash-${process.pid}-${Date.now()}.mjs`);
    await writeFile(scriptPath, script, 'utf8');
    context.after(() => rm(scriptPath, { force: true }));
    const victim = spawn(process.execPath, ['--import', 'tsx', scriptPath, root], { stdio: ['ignore', 'pipe', 'ignore'] });
    context.after(() => { victim.kill('SIGKILL'); });
    await new Promise<void>((resolve) => { victim.stdout.once('data', () => { resolve(); }); });

    const beforeCrash = rawSessions(dbPath);
    assert.equal(beforeCrash.length, 1, 'the victim created no implicit row');
    victim.kill('SIGKILL');
    await new Promise<void>((resolve) => { victim.on('close', () => { resolve(); }); });
    // Crash cleanup is asynchronous: the chained helper exits within one poll
    // interval of its owner dying, so wait (bounded) for both pids to be gone.
    const claimPid = (JSON.parse(beforeCrash[0]?.metadata ?? '{}') as { brudHistoryClaim?: { pid?: number; helperPid?: number } }).brudHistoryClaim;
    for (const pid of [claimPid?.pid, claimPid?.helperPid]) {
      for (let waited = 0; pid !== undefined && waited < 3000; waited += 25) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise<void>((resolve) => { setTimeout(resolve, 25); });
      }
    }

    // The next boot sweeps the dead claim, then retention reclaims the row.
    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver: new DurableNodeStorageDriver() });
    context.after(() => store.close());
    await store.open();
    store.reclaimOrphanedClaims(Date.now());
    const afterSweep = rawSessions(dbPath);
    const claimAfterSweep = JSON.parse(afterSweep[0]?.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number; releasedBy?: string } };
    assert.equal(claimAfterSweep.brudHistoryClaim?.alive, 0, 'the killed owner\'s claim was not released');
    assert.equal(claimAfterSweep.brudHistoryClaim?.releasedBy, 'reducer');

    const report = store.applyRetention({ cutoffMs: Date.now(), minUndoEntries: 1 });
    assert.ok(report.sessionsRemoved >= 1, `retention removed ${report.sessionsRemoved} sessions`);
    assert.deepEqual(rawSessions(dbPath), [], 'the crashed owner\'s empty row survived retention');
  });

  it('T-2.2-c: the row and its claim are committed by exactly one transaction', async (context) => {
    const { dbPath, store } = await fileStore(context, 'brud-rl-t22c-');
    // A reader connection independent of the store's own.
    const reader = new DatabaseSync(dbPath);
    context.after(() => reader.close());
    reader.exec('PRAGMA busy_timeout = 5000');
    const sessionCount = (): number => (reader.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

    // Commit boundaries are observable in the write-ahead log: every commit
    // writes one frame whose "database size after commit" field is non-zero.
    // Counting those frames around one `createSession` counts the transactions
    // that made the row and its claim visible. A claim published by a second
    // statement in a second transaction adds a second commit frame; the one
    // `INSERT` adds exactly one, so no reader can ever observe the row without
    // its claim.
    const commitsBefore = walCommitFrames(dbPath);
    const rowsBefore = sessionCount();
    const created = store.createSession({
      prompt: 'automatic recording',
      implicit: true,
      metadata: { declaredTargets: ['kept.txt'] },
      now: Date.now(),
      claim: claim(process.pid),
    });
    const commits = walCommitFrames(dbPath) - commitsBefore;
    const rowsAdded = sessionCount() - rowsBefore;

    assert.equal(rowsAdded, 1, 'the insert created a number of rows other than one');
    assert.equal(commits, 1,
      `the row and its claim took ${commits} commits to become visible; the claim must be published by the same INSERT as the row`);

    // That single commit carries both the row and its claim, with the caller's
    // metadata preserved.
    const row = reader.prepare('SELECT metadata FROM sessions WHERE session_id = ?').get(created.sessionId) as { metadata: string | null } | undefined;
    assert.ok(row !== undefined, 'the row is missing');
    const metadata = JSON.parse(row.metadata ?? '{}') as {
      brudHistoryClaim?: { alive?: number; releasedAt?: number | null };
      declaredTargets?: unknown;
    };
    assert.equal(metadata.brudHistoryClaim?.alive, 1);
    assert.equal(metadata.brudHistoryClaim?.releasedAt, null);
    assert.deepEqual(metadata.declaredTargets, ['kept.txt']);
  });

  it('T-2.4-b: the reducer inside applyRetention releases a crashed owner\'s claim, not the boot sweep', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-rl-t24b-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const historyRoot = join(root, '.brud', 'history');
    const dbPath = join(historyRoot, 'universal.db');
    // A real process boots a kernel, leaves a claimed empty row behind, and is
    // killed without disposing. No later boot of that owner ever happens, so
    // the boot sweep is not available to the assertion below.
    const script = `
const { createStandardKernel } = await import(${JSON.stringify(new URL('../../../../src/bootstrap/index.ts', import.meta.url).href)});
const kernel = createStandardKernel();
await kernel.boot({ workspaceRoot: process.argv[2] });
process.stdout.write('ready');
await new Promise(() => {});
`;
    const scriptPath = join(root, '..', `retention-reducer-${process.pid}-${Date.now()}.mjs`);
    await writeFile(scriptPath, script, 'utf8');
    context.after(() => rm(scriptPath, { force: true }));
    const victim = spawn(process.execPath, ['--import', 'tsx', scriptPath, root], { stdio: ['ignore', 'pipe', 'ignore'] });
    context.after(() => { victim.kill('SIGKILL'); });
    await new Promise<void>((resolve) => { victim.stdout.once('data', () => { resolve(); }); });

    const beforeCrash = rawSessions(dbPath);
    assert.equal(beforeCrash.length, 1, 'the victim created no implicit row');
    const deadId = beforeCrash[0]?.session_id as string;
    const deadClaim = (JSON.parse(beforeCrash[0]?.metadata ?? '{}') as { brudHistoryClaim?: { pid?: number; helperPid?: number; alive?: number } }).brudHistoryClaim;
    assert.equal(deadClaim?.alive, 1, 'the victim published no live claim');
    victim.kill('SIGKILL');
    await new Promise<void>((resolve) => { victim.on('close', () => { resolve(); }); });
    for (const pid of [deadClaim?.pid, deadClaim?.helperPid]) {
      for (let waited = 0; pid !== undefined && waited < 3000; waited += 25) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise<void>((resolve) => { setTimeout(resolve, 25); });
      }
    }

    const store = new UnifiedHistoryStore({ dbPath, historyRoot, driver: new DurableNodeStorageDriver() });
    context.after(() => store.close());
    await store.open();
    // A second, genuinely live claim owned by this process. The reducer must
    // leave it alone while releasing the crashed one, so a mutant that releases
    // every claim unconditionally is also caught here.
    const live = store.createSession({ prompt: 'automatic recording', implicit: true, now: Date.now(), claim: claim(process.pid) });

    // Deliberately NO reclaimOrphanedClaims(): only the reducer that runs
    // inside applyRetention's tail transaction can clear the dead claim.
    const report = store.applyRetention({ cutoffMs: Date.now(), minUndoEntries: 1, claimLiveness: 'native' });

    const survivors = rawSessions(dbPath);
    assert.equal(survivors.some((row) => row.session_id === deadId), false,
      `the crashed owner's row ${deadId} survived retention: the reducer did not release its claim`);
    assert.ok(report.sessionsRemoved >= 1, `retention removed ${report.sessionsRemoved} sessions`);
    const liveRow = survivors.find((row) => row.session_id === live.sessionId);
    assert.ok(liveRow !== undefined, 'the reducer released a claim whose owner is alive');
    const liveClaim = (JSON.parse(liveRow.metadata ?? '{}') as { brudHistoryClaim?: { alive?: number; releasedAt?: number | null } }).brudHistoryClaim;
    assert.equal(liveClaim?.alive, 1, 'the reducer released a claim whose owner is alive');
    assert.equal(liveClaim?.releasedAt, null);
  });

  it('N-1: a live claim pasted into metadata does not make an unclaimed row live', async (context) => {
    const { dbPath, store } = await fileStore(context, 'brud-rl-n1-');
    const live = store.createSession({ prompt: 'automatic recording', implicit: true, now: Date.now(), claim: claim(process.pid) });
    const liveRow = rawSessions(dbPath).find((row) => row.session_id === live.sessionId);
    const parsedMetadata = JSON.parse(liveRow?.metadata ?? '{}') as { brudHistoryClaim?: Record<string, unknown> };
    const claimText = parsedMetadata.brudHistoryClaim;
    // Without the claim model there is no live claim to copy, and an
    // always-reclaimable predicate would pass for the wrong reason: this case
    // exists only to prove the predicate is structural, so it fails closed.
    assert.ok(claimText !== undefined, 'the creating store published no claim to copy');

    // A store-created implicit row with no claim whose metadata carries the
    // live claim's object verbatim in `declaredTargets`.
    const impostor = store.createSession({
      prompt: 'automatic recording',
      implicit: true,
      now: Date.now(),
      metadata: { declaredTargets: [JSON.stringify(claimText)] },
    });

    store.applyRetention({ cutoffMs: Date.now(), minUndoEntries: 1, keepSessionId: live.sessionId });
    const survivors = rawSessions(dbPath).map((row) => row.session_id);
    assert.equal(survivors.includes(impostor.sessionId), false,
      'a row whose metadata merely contains a live claim was treated as live');
    assert.equal(survivors.includes(live.sessionId), true, 'the claimed row was removed');
  });
});
