/**
 * Legacy import gate (D-15, U-5 / G-U5). The fixture is a frozen workspace
 * produced by the legacy engines themselves (see `legacyFixture`), imported by
 * booting the unified engine on a copy of it.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createStandardKernel } from '../../../../src/bootstrap/index.js';
import type { KernelLogger, ServiceContext } from '../../../../src/contracts/lifecycle.js';
import type { BrudKernel } from '../../../../src/engine/BrudKernel.js';
import { FileSystemToken } from '../../../BrudFileSystem/descriptor/tokens.js';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { IUniversalHistory } from '../../contracts/IUniversalHistory.js';
import type { IUniversalHistoryService } from '../../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import { HistoryToken, UniversalHistoryToken } from '../../descriptor/tokens.js';
import { UnifiedSessionNotRevertibleError } from '../engine/errors.js';

const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const LARGE_BEFORE = 'a'.repeat(70 * 1024);
const LARGE_AFTER = 'b'.repeat(70 * 1024);

interface Booted {
  readonly kernel: BrudKernel;
  readonly fs: IBrudFileSystem;
  readonly sessions: IUniversalHistoryService;
  readonly journal: IUniversalHistory;
  readonly warnings: { message: string; meta?: Record<string, unknown> }[];
}

async function boot(root: string): Promise<Booted> {
  const warnings: { message: string; meta?: Record<string, unknown> }[] = [];
  const logger: KernelLogger = { warn: (message, meta) => warnings.push({ message, ...(meta === undefined ? {} : { meta }) }) };
  const kernel = createStandardKernel({ logger });
  await kernel.boot({ workspaceRoot: root });
  const caller: ServiceContext = { callerId: 'import.test', tier: 'core', workspaceRoot: root };
  return {
    kernel,
    fs: kernel.requestAccess(caller, FileSystemToken),
    sessions: kernel.requestAccess(caller, UniversalHistoryToken),
    journal: kernel.requestAccess(caller, HistoryToken),
    warnings,
  };
}

async function sourceHashes(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of ['ledger.db', 'history.db', 'seq.json']) {
    out[name] = sha(await readFile(join(root, '.brud', 'history', name)));
  }
  return out;
}

function unifiedCounts(root: string): { entries: number; imports: string[] } {
  const db = new DatabaseSync(join(root, '.brud', 'history', 'universal.db'), { readOnly: true });
  try {
    const entries = (db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n;
    const imports = (db.prepare('SELECT source FROM imports ORDER BY source').all() as { source: string }[]).map((r) => r.source);
    return { entries, imports };
  } finally {
    db.close();
  }
}

interface Fixture {
  readonly root: string;
  readonly ids: { text: string; binary: string; large: string; reverted: string; aborted: string; active: string };
  readonly checkpoint: string;
  readonly maxLegacySequence: number;
}

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/legacy-v1/', import.meta.url));

interface FixtureManifest {
  readonly ids: Fixture['ids'];
  readonly checkpoint: string;
  readonly maxLegacySequence: number;
}

/**
 * Copies the frozen legacy workspace into a temporary root.
 *
 * `fixtures/legacy-v1` was produced once by the real legacy engines (commit
 * dc58452, before they were removed in D-15 U-7), running exactly the steps
 * the U-5 fixture builder ran: text, binary, large, reverted, aborted and
 * active sessions, then a journal run with a checkpoint and one undo. The
 * history folder is stored as `history/` because `.brud/` is git-ignored.
 *
 * The session counter in `seq.json` is moved to today (UTC) so "new ids
 * continue after the legacy sequence" stays meaningful on any day; the copy is
 * made before any import, so source hashes are taken after this step.
 */
async function legacyFixture(context: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'brud-unified-import-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(FIXTURE_DIR, 'workspace'), root, { recursive: true });
  await cp(join(FIXTURE_DIR, 'history'), join(root, '.brud', 'history'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as FixtureManifest;
  // Fixture integrity: the workspace holds the post-session state.
  assert.equal(sha(await readFile(join(root, 'data', 'big.txt'))), sha(LARGE_AFTER));
  const today = new Date().toISOString().slice(0, 10).replace(/-/gu, '');
  await writeFile(
    join(root, '.brud', 'history', 'seq.json'),
    `${JSON.stringify({ date: today, sequence: manifest.maxLegacySequence }, null, 2)}\n`,
  );
  return { root, ids: manifest.ids, checkpoint: manifest.checkpoint, maxLegacySequence: manifest.maxLegacySequence };
}

describe('legacy history import (G-U5)', () => {
  it('imports legacy sessions and journal faithfully, leaves the sources untouched, and is idempotent', async (context) => {
    const fixture = await legacyFixture(context);
    const before = await sourceHashes(fixture.root);
    const unified = await boot(fixture.root);
    context.after(async () => {
      if (unified.kernel.lifecycleState === 'RUNNING') {
        await unified.kernel.shutdown();
      }
    });
    const { fs, sessions, journal } = unified;

    assert.deepEqual(unified.warnings.filter((w) => w.meta?.code === 'HISTORY_IMPORT_FAILED'), []);

    // Journal first: undo/redo continue across the import boundary (later session
    // reverts are new edits and would correctly discard the redo tail).
    assert.ok((await journal.getCheckpoints()).some((c) => c.checkpointId === fixture.checkpoint));
    assert.equal((await journal.redo()).status, 'success');
    assert.equal(await fs.readText('notes.txt'), 'n3\n');
    assert.equal((await journal.undo(2)).status, 'success');
    assert.equal(await fs.readText('notes.txt'), 'n1\n');
    assert.equal((await journal.rollbackToCheckpoint(fixture.checkpoint)).status, 'success');
    assert.equal(await fs.readText('notes.txt'), 'n1\n');

    // Sessions: statuses (legacy active → aborted, its baseline only lived in memory).
    const rows = await sessions.listSessions({ limit: 100 } as never);
    const status = Object.fromEntries(rows.map((r) => [r.session_id, r.status]));
    assert.equal(status[fixture.ids.text], 'committed');
    assert.equal(status[fixture.ids.binary], 'committed');
    assert.equal(status[fixture.ids.large], 'committed');
    assert.equal(status[fixture.ids.reverted], 'reverted');
    assert.equal(status[fixture.ids.aborted], 'aborted');
    assert.equal(status[fixture.ids.active], 'aborted');

    const manifest = await sessions.getSession(fixture.ids.text);
    assert.deepEqual([...(manifest?.filesAffected ?? [])], ['src/app.txt', 'src/new.txt', 'src/same.txt']);
    assert.equal(manifest?.preDigests['src/app.txt']?.sha256, sha('line1\nline2\n'));
    assert.equal(manifest?.postDigests['src/app.txt']?.sha256, sha('line1\nCHANGED\n'));
    assert.equal((await sessions.getSession(fixture.ids.reverted))?.revertRecordIds?.length, 1);

    // Imported sessions revert: text via the legacy diff, binary and large via blobs.
    const textPlan = await sessions.planReversal(fixture.ids.text);
    assert.equal(textPlan.isExecutable, true, JSON.stringify(textPlan.conflicts));
    await sessions.executeReversal(textPlan);
    assert.equal(await fs.readText('src/app.txt'), 'line1\nline2\n');
    assert.equal(await fs.exists('src/new.txt'), false);
    assert.equal(await fs.readText('src/same.txt'), 'same\n');

    await sessions.executeReversal(await sessions.planReversal(fixture.ids.binary));
    assert.deepEqual(Array.from(await fs.readFile('bin/x.bin')), [0, 1, 2]);
    await sessions.executeReversal(await sessions.planReversal(fixture.ids.large));
    assert.equal(sha(await fs.readFile('data/big.txt')), sha(LARGE_BEFORE));
    await assert.rejects(() => sessions.planReversal(fixture.ids.reverted), UnifiedSessionNotRevertibleError);

    // New ids continue after the legacy sequence.
    const next = await sessions.beginSession('new after import');
    assert.ok(Number(next.split('-')[2]) > fixture.maxLegacySequence, `${next} must follow ${fixture.maxLegacySequence}`);

    await unified.kernel.shutdown();

    // Sources untouched; re-import is a no-op.
    assert.deepEqual(await sourceHashes(fixture.root), before);
    const first = unifiedCounts(fixture.root);
    assert.deepEqual(first.imports, ['history.db', 'ledger.db', 'seq.json']);
    const again = await boot(fixture.root);
    await again.kernel.shutdown();
    assert.equal(unifiedCounts(fixture.root).entries, first.entries);
    assert.deepEqual(await sourceHashes(fixture.root), before);
    assert.deepEqual(again.warnings.filter((w) => w.meta?.code === 'HISTORY_IMPORT_FAILED'), []);
  });

  it('reports a legacy source that changed after import and does not import it again', async (context) => {
    const fixture = await legacyFixture(context);
    const first = await boot(fixture.root);
    await first.kernel.shutdown();
    const counts = unifiedCounts(fixture.root);

    const ledger = new DatabaseSync(join(fixture.root, '.brud', 'history', 'ledger.db'));
    ledger.prepare("INSERT INTO sessions (session_id, created_at, prompt, status, files_affected) VALUES ('BR-20990101-001', '2099-01-01T00:00:00.000Z', 'late', 'committed', '[]')").run();
    ledger.close();

    const second = await boot(fixture.root);
    await second.kernel.shutdown();
    const changed = second.warnings.filter((w) => w.meta?.code === 'HISTORY_IMPORT_FAILED');
    assert.equal(changed.length, 1);
    assert.equal(changed[0]?.meta?.source, 'ledger.db');
    assert.equal(changed[0]?.meta?.status, 'source-changed');
    assert.equal(unifiedCounts(fixture.root).entries, counts.entries);
  });

  it('rebuilds text sessions from the legacy diff when the journal holds no copy', async (context) => {
    const fixture = await legacyFixture(context);
    // Only the session ledger survives: no journal database and no journal blobs.
    await rm(join(fixture.root, '.brud', 'history', 'history.db'), { force: true });
    await rm(join(fixture.root, '.brud', 'history', 'history.db-wal'), { force: true });
    await rm(join(fixture.root, '.brud', 'history', 'history.db-shm'), { force: true });
    const unified = await boot(fixture.root);
    context.after(async () => {
      if (unified.kernel.lifecycleState === 'RUNNING') {
        await unified.kernel.shutdown();
      }
    });
    assert.deepEqual(unifiedCounts(fixture.root).imports, ['ledger.db', 'seq.json']);
    const plan = await unified.sessions.planReversal(fixture.ids.text);
    assert.equal(plan.isExecutable, true, JSON.stringify(plan.conflicts));
    await unified.sessions.executeReversal(plan);
    assert.equal(await unified.fs.readText('src/app.txt'), 'line1\nline2\n');
  });

  it('boots without legacy files and records no imports', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'brud-unified-noimport-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const unified = await boot(root);
    await unified.kernel.shutdown();
    assert.equal(existsSync(join(root, '.brud', 'history', 'ledger.db')), false);
    assert.deepEqual(unifiedCounts(root).imports, []);
  });
});
