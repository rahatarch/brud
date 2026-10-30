/**
 * History parity oracle (D-15, increment U-P).
 *
 * Black-box behaviour of kernel history, exercised only through public
 * surfaces on a real, booted, on-disk kernel. It must pass unchanged on the
 * legacy engines (today) and on the unified engine (U-4, U-6).
 *
 * Subject selection: BRUD_HISTORY_ORACLE_SUBJECT=legacy (default) | unified.
 *
 * Coverage outside this file, designated as part of the oracle:
 * - Wire contract: packages/daemon/src/__tests__/dispatch.test.ts
 *   "drives a history session end-to-end over the socket",
 *   "returns non-executable plans with conflicts when a reversal is stale";
 *   packages/daemon/src/__tests__/client.test.ts
 *   "drives history sessions through the typed client helpers".
 * - Not black-box observable (internal only, re-specified for the new engine
 *   in U-3): background ingestion failures forwarded to the error sink
 *   (legacy F5, JournalSubscriber).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createLegacySubject } from './historyOracle/legacySubject.js';
import { createUnifiedSubject } from './historyOracle/unifiedSubject.js';
import type {
  HistoryOracleSubject,
  HistoryOracleSubjectFactory,
  HistoryOracleSubjectOptions,
  OracleErrorKind,
} from './historyOracle/subject.js';

const SUBJECTS: Record<string, HistoryOracleSubjectFactory> = {
  legacy: createLegacySubject,
  unified: createUnifiedSubject,
};

const SUBJECT_NAME = process.env.BRUD_HISTORY_ORACLE_SUBJECT ?? 'legacy';

function factory(): HistoryOracleSubjectFactory {
  const selected = SUBJECTS[SUBJECT_NAME];
  if (selected === undefined) {
    throw new Error(`Unknown history oracle subject "${SUBJECT_NAME}"`);
  }
  return selected;
}

async function open(context: TestContext, options?: HistoryOracleSubjectOptions): Promise<HistoryOracleSubject> {
  const subject = await factory()(options);
  context.after(() => subject.dispose());
  return subject;
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function bytes(value: Uint8Array): number[] {
  return Array.from(value);
}

async function rejectsAs(
  subject: HistoryOracleSubject,
  action: () => Promise<unknown>,
  kind: OracleErrorKind,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(subject.classifyError(error), kind, `expected ${kind}, got: ${String(error)}`);
    return true;
  });
}

const LARGE = 70 * 1024;
const large = (seed: string): string => `${seed}:${'x'.repeat(LARGE)}`;

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe(`history parity oracle [${SUBJECT_NAME}] — sessions`, () => {
  it('S1 records, commits, and reverts a text, binary, and created file', async (context) => {
    const h = await open(context);
    const text = 'src/app.ts';
    const binary = 'assets/icon.bin';
    const created = 'src/created.ts';
    const binaryBefore = Uint8Array.from([0x00, 0x01, 0x02, 0xff]);
    const binaryAfter = Uint8Array.from([0x00, 0x09, 0x08, 0xfe]);

    await h.fs.writeAtomic(text, 'export const value = 1;\n');
    await h.fs.writeAtomic(binary, binaryBefore);

    const id = await h.beginSession('edit three targets', [text, binary, created]);
    assert.match(id, /^BR-\d{8}-\d{3,}$/u);

    await h.fs.writeAtomic(text, 'export const value = 2;\n');
    await h.fs.writeAtomic(binary, binaryAfter);
    await h.fs.writeAtomic(created, 'export const created = true;\n');

    assert.equal((await h.commitSession(id, 'completed')).committedFileCount, 3);

    const session = await h.getSession(id);
    assert.ok(session);
    assert.equal(session.status, 'committed');
    assert.deepEqual([...session.filesAffected].sort(), [binary, created, text].sort());
    assert.equal(session.preDigests[text], sha256('export const value = 1;\n'));
    assert.equal(session.postDigests[text], sha256('export const value = 2;\n'));
    assert.equal(session.preDigests[created], null);

    const plan = await h.planReversal(id);
    assert.equal(plan.targetState, 'pre');
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.actions.length, 3);
    assert.deepEqual(plan.actions.find((a) => a.path === created)?.action, 'delete');

    const receipt = await h.executeReversal(plan);
    assert.equal(receipt.filesRestored, 2);
    assert.equal(receipt.filesDeleted, 1);

    assert.equal(await h.fs.readText(text), 'export const value = 1;\n');
    assert.deepEqual(bytes(await h.fs.readFile(binary)), bytes(binaryBefore));
    assert.equal(await h.fs.exists(created), false);

    const reverted = await h.getSession(id);
    assert.equal(reverted?.status, 'reverted');
    assert.equal(reverted?.reversalCount, 1);
  });

  it('S2 lists sessions newest first with status and limit filters', async (context) => {
    const h = await open(context);
    const completed = await h.beginSession('completed');
    await h.commitSession(completed, 'completed');
    const aborted = await h.beginSession('aborted');
    await h.commitSession(aborted, 'aborted');

    const all = await h.listSessions();
    assert.deepEqual(all.map((row) => row.sessionId), [aborted, completed]);
    assert.deepEqual((await h.listSessions({ status: 'aborted' })).map((row) => row.sessionId), [aborted]);
    assert.equal((await h.listSessions({ limit: 1 })).length, 1);
  });

  it('S3 aborted sessions persist no files and cannot be reverted or re-committed', async (context) => {
    const h = await open(context);
    await h.fs.writeAtomic('src/aborted.ts', 'before\n');
    const id = await h.beginSession('abort', ['src/aborted.ts']);
    await h.fs.writeAtomic('src/aborted.ts', 'after\n');

    assert.equal((await h.commitSession(id, 'aborted')).committedFileCount, 0);
    assert.equal((await h.getSession(id))?.status, 'aborted');
    await rejectsAs(h, () => h.planReversal(id), 'SESSION_NOT_REVERTIBLE');
    await rejectsAs(h, () => h.commitSession(id, 'completed'), 'SESSION_INACTIVE');
    assert.equal(await h.fs.readText('src/aborted.ts'), 'after\n');
  });

  it('S4 unknown sessions are null on read and rejected on commit and plan', async (context) => {
    const h = await open(context);
    assert.equal(await h.getSession('BR-20260501-404'), null);
    await rejectsAs(h, () => h.commitSession('BR-20260501-404', 'completed'), 'SESSION_NOT_FOUND');
    await rejectsAs(h, () => h.planReversal('BR-20260501-404'), 'SESSION_NOT_FOUND');
  });

  it('S5 declared targets that did not change are listed but not committed or reverted', async (context) => {
    const h = await open(context);
    const declared = ['src/same.ts', 'src/changed.ts', 'src/never.ts'];
    await h.fs.writeAtomic('src/same.ts', 'same\n');
    await h.fs.writeAtomic('src/changed.ts', 'old\n');
    const id = await h.beginSession('one change', declared);
    await h.fs.writeAtomic('src/changed.ts', 'new\n');

    assert.equal((await h.commitSession(id, 'completed')).committedFileCount, 1);
    // Observed legacy behaviour: the manifest lists every declared target.
    assert.deepEqual((await h.getSession(id))?.filesAffected, declared);
    const plan = await h.planReversal(id);
    assert.deepEqual(plan.actions, [{ path: 'src/changed.ts', action: 'restore' }]);
    await h.executeReversal(plan);
    assert.equal(await h.fs.readText('src/changed.ts'), 'old\n');
    assert.equal(await h.fs.readText('src/same.ts'), 'same\n');
    assert.equal(await h.fs.exists('src/never.ts'), false);
  });

  it('S6 a file changed after the session blocks reversal with a stale-baseline conflict', async (context) => {
    const h = await open(context);
    await h.fs.writeAtomic('src/a.ts', 'before\n');
    const id = await h.beginSession('stale', ['src/a.ts']);
    await h.fs.writeAtomic('src/a.ts', 'after\n');
    await h.commitSession(id, 'completed');
    await h.writeExternally('src/a.ts', 'edited by hand\n');

    const plan = await h.planReversal(id);
    assert.equal(plan.isExecutable, false);
    assert.deepEqual(plan.conflicts.map((c) => [c.path, c.code]), [['src/a.ts', 'STALE_BASELINE_CONFLICT']]);
    await rejectsAs(h, () => h.executeReversal(plan), 'PLAN_NOT_EXECUTABLE');
    assert.equal(await h.fs.readText('src/a.ts'), 'edited by hand\n');
    assert.equal((await h.getSession(id))?.status, 'committed');
  });

  it('S7 reverting restores a file the session deleted', async (context) => {
    const h = await open(context);
    await h.fs.writeAtomic('docs/keep.md', 'keep me\n');
    const id = await h.beginSession('delete', ['docs/keep.md']);
    await h.fs.deleteFile('docs/keep.md');
    await h.commitSession(id, 'completed');

    const plan = await h.planReversal(id);
    assert.deepEqual(plan.actions, [{ path: 'docs/keep.md', action: 'restore' }]);
    await h.executeReversal(plan);
    assert.equal(await h.fs.readText('docs/keep.md'), 'keep me\n');
  });

  it('S8 a post-state plan re-applies the session forward', async (context) => {
    const h = await open(context);
    await h.fs.writeAtomic('src/a.ts', 'before\n');
    const id = await h.beginSession('forward', ['src/a.ts']);
    await h.fs.writeAtomic('src/a.ts', 'after\n');
    await h.commitSession(id, 'completed');
    await h.fs.writeAtomic('src/a.ts', 'before\n');

    const plan = await h.planReversal(id, 'post');
    assert.equal(plan.targetState, 'post');
    assert.equal(plan.isExecutable, true);
    await h.executeReversal(plan);
    assert.equal(await h.fs.readText('src/a.ts'), 'after\n');
  });

  it('S9 large text round-trips through a session revert byte for byte', async (context) => {
    const h = await open(context);
    const before = large('before');
    await h.fs.writeAtomic('data/big.txt', before);
    const id = await h.beginSession('large', ['data/big.txt']);
    await h.fs.writeAtomic('data/big.txt', large('after'));
    await h.commitSession(id, 'completed');

    await h.executeReversal(await h.planReversal(id));
    assert.equal(sha256(await h.fs.readFile('data/big.txt')), sha256(before));
  });

  it('S10 missing stored content makes the plan non-executable (BLOB_NOT_FOUND)', async (context) => {
    const h = await open(context);
    const before = Uint8Array.from([0x00, 0x01]);
    const after = Uint8Array.from([0x00, 0x02, 0x03]);
    await h.fs.writeAtomic('bin/x.bin', before);
    const id = await h.beginSession('blob', ['bin/x.bin']);
    await h.fs.writeAtomic('bin/x.bin', after);
    await h.commitSession(id, 'completed');
    await h.fs.writeAtomic('bin/x.bin', before);

    assert.ok((await h.removeStoredContent(sha256(after))) > 0, 'fault injection removed no content');

    const plan = await h.planReversal(id, 'post');
    assert.equal(plan.isExecutable, false);
    assert.deepEqual(plan.conflicts.map((c) => [c.path, c.code]), [['bin/x.bin', 'BLOB_NOT_FOUND']]);
  });

  it('S11 an empty session yields an executable empty plan', async (context) => {
    const h = await open(context);
    const id = await h.beginSession('empty');
    await h.commitSession(id, 'completed');
    const plan = await h.planReversal(id);
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.actions, []);
  });

  it('S12 planning has no side effects', async (context) => {
    const h = await open(context);
    await h.fs.writeAtomic('src/a.ts', 'before\n');
    const id = await h.beginSession('pure', ['src/a.ts']);
    await h.fs.writeAtomic('src/a.ts', 'after\n');
    await h.commitSession(id, 'completed');

    await h.planReversal(id);
    await h.planReversal(id, 'post');
    assert.equal(await h.fs.readText('src/a.ts'), 'after\n');
    assert.equal((await h.getSession(id))?.status, 'committed');
    assert.equal((await h.getSession(id))?.reversalCount, 0);
  });

  it('S13 a reverted session cannot be planned again', async (context) => {
    const h = await open(context);
    await h.fs.writeAtomic('src/a.ts', 'before\n');
    const id = await h.beginSession('once', ['src/a.ts']);
    await h.fs.writeAtomic('src/a.ts', 'after\n');
    await h.commitSession(id, 'completed');
    await h.executeReversal(await h.planReversal(id));
    await rejectsAs(h, () => h.planReversal(id), 'SESSION_NOT_REVERTIBLE');
  });

  it('S14 session identifiers are BR-YYYYMMDD-NNN and strictly increase', async (context) => {
    const h = await open(context);
    const ids = [await h.beginSession('a'), await h.beginSession('b'), await h.beginSession('c')];
    for (const id of ids) {assert.match(id, /^BR-\d{8}-\d{3,}$/u);}
    const seq = ids.map((id) => Number(id.split('-')[2]));
    assert.ok(seq[0]! < seq[1]! && seq[1]! < seq[2]!, `not increasing: ${ids.join(', ')}`);
  });
});

describe(`history parity oracle [${SUBJECT_NAME}] — undo, redo, checkpoints`, () => {
  it('J1 undo and redo walk exact historical states', async (context) => {
    const h = await open(context);
    await h.openRecordingSession('walk');
    await h.fs.writeAtomic('src/a.txt', 'first\n');
    await h.fs.writeAtomic('src/a.txt', 'second\n');
    await h.fs.createFile('src/b.txt', 'created later\n');
    await h.fs.deleteFile('src/a.txt');
    await h.settle();

    const entries = (await h.listFileEntries()).filter((e) => e.operation !== 'mkdir');
    assert.deepEqual(
      entries.map((e) => [e.path, e.operation, e.previousHash, e.updatedHash]),
      [
        ['src/a.txt', 'unlink', sha256('second\n'), ''],
        ['src/b.txt', 'write', '', sha256('created later\n')],
        ['src/a.txt', 'write', sha256('first\n'), sha256('second\n')],
        ['src/a.txt', 'write', '', sha256('first\n')],
      ],
    );

    assert.equal((await h.undo()).status, 'success');
    assert.equal(await h.fs.readText('src/a.txt'), 'second\n');
    assert.equal((await h.undo()).status, 'success');
    assert.equal(await h.fs.exists('src/b.txt'), false);
    assert.equal((await h.undo()).status, 'success');
    assert.equal(await h.fs.readText('src/a.txt'), 'first\n');
    assert.equal((await h.undo()).status, 'success');
    assert.equal(await h.fs.exists('src/a.txt'), false);

    const exhausted = await h.undo();
    assert.equal(exhausted.status, 'success');
    assert.deepEqual(exhausted.restoredPaths, []);

    await h.redo();
    assert.equal(await h.fs.readText('src/a.txt'), 'first\n');
    await h.redo();
    assert.equal(await h.fs.readText('src/a.txt'), 'second\n');
    await h.redo();
    assert.equal(await h.fs.readText('src/b.txt'), 'created later\n');
    await h.redo();
    assert.equal(await h.fs.exists('src/a.txt'), false);
  });

  it('J2 checkpoint rollback restores every file to its checkpoint state', async (context) => {
    const h = await open(context);
    await h.openRecordingSession('checkpoint');
    await h.fs.writeAtomic('cp/one.txt', 'one v1\n');
    await h.fs.writeAtomic('cp/two.txt', 'two v1\n');
    await h.settle();
    const checkpoint = await h.recordCheckpoint('v1');
    await h.fs.writeAtomic('cp/one.txt', 'one v2\n');
    await h.fs.writeAtomic('cp/two.txt', 'two v2\n');
    await h.fs.writeAtomic('cp/three.txt', 'three v2\n');
    await h.settle();

    const report = await h.rollbackToCheckpoint(checkpoint);
    assert.equal(report.status, 'success');
    assert.equal(await h.fs.readText('cp/one.txt'), 'one v1\n');
    assert.equal(await h.fs.readText('cp/two.txt'), 'two v1\n');
    assert.equal(await h.fs.exists('cp/three.txt'), false);
  });

  it('J3 checkpoint rollback aborts on external drift and writes nothing', async (context) => {
    const h = await open(context);
    await h.openRecordingSession('drift');
    await h.fs.writeAtomic('docs/report.txt', 'base\n');
    await h.settle();
    const checkpoint = await h.recordCheckpoint('before change');
    await h.fs.writeAtomic('docs/report.txt', 'recorded\n');
    await h.settle();
    await h.writeExternally('docs/report.txt', 'manual tamper\n');

    const report = await h.rollbackToCheckpoint(checkpoint);
    assert.equal(report.status, 'drift_aborted');
    assert.deepEqual(report.restoredPaths, []);
    assert.deepEqual(report.detectedDrift, [{
      path: 'docs/report.txt',
      expectedHash: sha256('recorded\n'),
      actualHash: sha256('manual tamper\n'),
    }]);
    assert.equal(await h.fs.readText('docs/report.txt'), 'manual tamper\n');
  });

  it('J4 a new write after undo discards the redo tail', async (context) => {
    const h = await open(context);
    await h.openRecordingSession('redo-tail');
    await h.fs.writeAtomic('t.txt', 'v1\n');
    await h.fs.writeAtomic('t.txt', 'v2\n');
    await h.settle();
    await h.undo();
    assert.equal(await h.fs.readText('t.txt'), 'v1\n');

    await h.fs.writeAtomic('t.txt', 'v3\n');
    await h.settle();
    const redo = await h.redo();
    assert.equal(redo.status, 'success');
    assert.deepEqual(redo.restoredPaths, []);
    assert.equal(await h.fs.readText('t.txt'), 'v3\n');
  });

  it('J5 corrupted stored content aborts undo with payload_corrupt and the cursor stays put', async (context) => {
    const h = await open(context);
    const original = large('original');
    const updated = large('updated');
    await h.openRecordingSession('corrupt');
    await h.fs.writeAtomic('assets/large.bin', original);
    await h.settle();
    await h.fs.writeAtomic('assets/large.bin', updated);
    await h.settle();

    assert.ok((await h.corruptStoredContent(sha256(original))) > 0, 'fault injection changed no content');

    const first = await h.undo();
    assert.equal(first.status, 'payload_corrupt');
    assert.deepEqual(first.restoredPaths, []);
    assert.deepEqual(first.corruptedPaths, ['assets/large.bin']);
    assert.equal(await h.fs.readText('assets/large.bin'), updated);

    // The cursor did not move: the same undo is attempted again and fails the same way.
    assert.equal((await h.undo()).status, 'payload_corrupt');
  });

  it('J6 one missing pre-image blocks a whole rollback with zero writes', async (context) => {
    const h = await open(context);
    const targets = ['batch/one.txt', 'batch/two.txt', 'batch/three.txt'];
    await h.openRecordingSession('batch');
    for (const target of targets) {await h.fs.writeAtomic(target, large(`base-${target}`));}
    await h.settle();
    const checkpoint = await h.recordCheckpoint('baseline');
    for (const target of targets) {await h.fs.writeAtomic(target, large(`rev-${target}`));}
    await h.settle();

    assert.ok((await h.removeStoredContent(sha256(large('base-batch/two.txt')))) > 0, 'fault injection removed no content');

    const report = await h.rollbackToCheckpoint(checkpoint);
    assert.equal(report.status, 'payload_missing');
    assert.deepEqual(report.restoredPaths, []);
    assert.deepEqual(report.skippedPaths, ['batch/two.txt']);
    for (const target of targets) {
      assert.equal(await h.fs.readText(target), large(`rev-${target}`));
    }
    assert.equal((await h.rollbackToCheckpoint(checkpoint)).status, 'payload_missing');
  });

  it('J7 large payloads round-trip through undo and stay out of the database file', async (context) => {
    const h = await open(context);
    const payload = 'x'.repeat(500 * 1024);
    await h.openRecordingSession('blob');
    await h.fs.writeAtomic('assets/big.txt', 'small\n');
    await h.fs.writeAtomic('assets/big.txt', payload);
    await h.fs.writeAtomic('assets/big.txt', 'small again\n');
    await h.settle();

    await h.undo();
    assert.equal(sha256(await h.fs.readFile('assets/big.txt')), sha256(payload));

    for (const file of await h.historyDatabaseFiles()) {
      assert.ok((await stat(file)).size < payload.length, `${file} holds the payload inline`);
    }
  });
});

describe(`history parity oracle [${SUBJECT_NAME}] — recording, concurrency, degraded mode`, () => {
  it('R1 records 40 concurrent writes as 40 distinct entries', async (context) => {
    const h = await open(context);
    await h.openRecordingSession('concurrent');
    const paths = Array.from({ length: 40 }, (_, i) => `concurrent/file-${i}.txt`);
    await Promise.all(paths.map((path, i) => h.fs.writeAtomic(path, `payload-${i}\n`)));
    await h.settle();

    const writes = (await h.listFileEntries({ operation: 'write' })).filter((e) => e.path.startsWith('concurrent/'));
    assert.equal(writes.length, 40);
    assert.equal(new Set(writes.map((e) => e.path)).size, 40);
  });

  it('R2 separate processes writing one workspace are all recorded without lock errors', async (context) => {
    const h = await open(context);
    const workerPath = join(h.workspaceRoot, '..', `oracle-worker-${process.pid}-${Date.now()}.mjs`);
    const bootstrapUrl = new URL('../bootstrap/index.ts', import.meta.url).href;
    const tokensUrl = new URL('../../services/BrudFileSystem/descriptor/tokens.ts', import.meta.url).href;

    await writeFile(workerPath, `
const { createStandardKernel } = await import(${JSON.stringify(bootstrapUrl)});
const { FileSystemToken } = await import(${JSON.stringify(tokensUrl)});
const [root, id, count] = process.argv.slice(2);
const kernel = createStandardKernel({ historyEngine: process.env.BRUD_HISTORY_ORACLE_SUBJECT === 'unified' ? 'unified' : 'legacy' });
await kernel.boot({ workspaceRoot: root });
const fs = kernel.requestAccess({ callerId: 'oracle.worker', tier: 'core', workspaceRoot: root }, FileSystemToken);
for (let i = 0; i < Number(count); i += 1) await fs.writeAtomic(\`workers/\${id}-\${i}.txt\`, \`\${id}-\${i}\\n\`);
await new Promise((resolve) => setTimeout(resolve, 200));
await kernel.shutdown();
`, 'utf8');
    context.after(() => import('node:fs/promises').then(({ rm }) => rm(workerPath, { force: true })));

    const workers = ['alpha', 'beta', 'gamma'];
    const results = await Promise.all(workers.map((id) => new Promise<{ id: string; code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', workerPath, h.workspaceRoot, id, '5'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ id, code, stderr }));
    })));

    for (const result of results) {
      assert.equal(result.code, 0, `${result.id} failed: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /database is locked|SQLITE_BUSY/u);
    }

    const recorded = (await h.listFileEntries({ operation: 'write' })).filter((e) => e.path.startsWith('workers/'));
    assert.equal(recorded.length, workers.length * 5);
  });

  it('R3 history storage is protected from ordinary writers', async (context) => {
    const h = await open(context);
    await rejectsAs(h, () => h.fs.writeAtomic('.brud/history/forged.json', '{}'), 'PROTECTED_PATH_DENIED');
  });

  // Contract from rollout plan §2.3.4 ("boot succeeds, ingestion is a no-op,
  // reversals throw HistoryDegradedError"). Known legacy defect F-UP-1: with
  // production defaults the session ledger opens ledger.db eagerly in its
  // factory, so a read-only .brud/history fails boot (state DISPOSED). The
  // legacy F6 test only passes because it moves the session ledger in memory.
  // The unified engine must pass this scenario.
  const r4Todo = SUBJECT_NAME === 'legacy'
    ? 'F-UP-1: legacy session ledger fails boot on read-only .brud/history (unified engine must pass)'
    : false;

  it('R4 a read-only history directory boots degraded: no recording, reversals refused', { todo: r4Todo }, async (context) => {
    if (isRoot) {
      context.skip('filesystem permissions are not enforced for uid 0');
      return;
    }
    const h = await open(context, { readOnlyHistoryDirectory: true });
    await h.openRecordingSession('degraded');
    await h.fs.writeAtomic('src/degraded.txt', 'payload\n');
    await h.settle();

    assert.deepEqual(await h.listFileEntries(), []);
    await rejectsAs(h, () => h.undo(), 'HISTORY_DEGRADED');
    await rejectsAs(h, () => h.redo(), 'HISTORY_DEGRADED');
    await rejectsAs(h, () => h.rollbackToCheckpoint('CP-missing'), 'HISTORY_DEGRADED');
    assert.ok(
      h.warnings.some((w) => w.code === 'HISTORY_DEGRADED' && w.reason === 'READ_ONLY_STORAGE'),
      `no HISTORY_DEGRADED warning: ${JSON.stringify(h.warnings)}`,
    );
  });
});
