import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { DirectoryEntry, FileStats } from '../../../../drivers/contracts/index.js';
import {
  SessionNotFoundError,
  SqliteLedger,
} from '../../storage/SqliteLedger/SqliteLedger.js';
import type {
  SessionFileInsertRow,
  SessionInsertRow,
} from '../../storage/SqliteLedger/types.js';
import { casBlobPath } from '../commit_session/commitSession.js';
import { createUnifiedDiff } from '../compute_delta/computeDelta.js';
import { planReversal } from './planReversal.js';
import { SessionNotRevertibleError } from './types.js';

const SESSION_ID = 'BR-20260301-001';
const CREATED_AT = '2026-03-01T09:00:00.000Z';

interface Harness {
  readonly ledger: SqliteLedger;
  readonly fileSystem: BrudFileSystem;
}

async function createHarness(context: TestContext): Promise<Harness> {
  const ledger = new SqliteLedger({ dbPath: ':memory:' });
  context.after(() => ledger.close());

  const fileSystem = new BrudFileSystem('/workspace', new InMemoryStorageDriver(), { trustedWriteScopes: ['.brud/history'] });
  await fileSystem.initialize();

  return { ledger, fileSystem };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sessionRow(sessionId: string, filesAffected: readonly string[] = []): SessionInsertRow {
  return {
    session_id: sessionId,
    created_at: CREATED_AT,
    prompt: 'reversal planning',
    status: 'active',
    files_affected: JSON.stringify(filesAffected),
  };
}

function textRow(
  relativePath: string,
  preText: string | null,
  postText: string | null,
): SessionFileInsertRow {
  const preBytes = preText === null ? null : Buffer.from(preText, 'utf8');
  const postBytes = postText === null ? null : Buffer.from(postText, 'utf8');
  let diffContent: string;

  if (preText === null) {
    diffContent = createUnifiedDiff(relativePath, '', postText ?? '', 'created');
  } else if (postText === null) {
    diffContent = createUnifiedDiff(relativePath, preText, '', 'deleted');
  } else {
    diffContent = createUnifiedDiff(relativePath, preText, postText, 'modified');
  }

  return {
    relative_path: relativePath,
    pre_sha256: preBytes === null ? '' : sha256(preBytes),
    post_sha256: postBytes === null ? '' : sha256(postBytes),
    diff_content: diffContent,
    blob_sha256: null,
    is_binary: 0,
  };
}

function binaryRow(
  relativePath: string,
  preBytes: Uint8Array,
  postBytes: Uint8Array,
  blobSha256: string | null,
): SessionFileInsertRow {
  return {
    relative_path: relativePath,
    pre_sha256: sha256(preBytes),
    post_sha256: sha256(postBytes),
    diff_content: null,
    blob_sha256: blobSha256,
    is_binary: 1,
  };
}

function commitRows(
  harness: Harness,
  sessionId: string,
  rows: readonly SessionFileInsertRow[],
): void {
  harness.ledger.createSession(
    sessionRow(sessionId, rows.map((row) => row.relative_path)),
  );
  harness.ledger.commitSession(sessionId, rows);
}

function decode(bytes: Uint8Array | null): string {
  assert.ok(bytes);
  return Buffer.from(bytes).toString('utf8');
}

class WriteGuardFileSystem implements IBrudFileSystem {
  readonly writeCalls: string[] = [];

  private readonly inner: IBrudFileSystem;

  constructor(inner: IBrudFileSystem) {
    this.inner = inner;
  }

  readFile(relativePath: string): Promise<Uint8Array> {
    return this.inner.readFile(relativePath);
  }

  readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    return this.inner.readText(relativePath, encoding);
  }

  async writeAtomic(relativePath: string): Promise<void> {
    this.writeCalls.push(`writeAtomic:${relativePath}`);
  }

  async createFile(relativePath: string): Promise<void> {
    this.writeCalls.push(`createFile:${relativePath}`);
  }

  async deleteFile(relativePath: string): Promise<void> {
    this.writeCalls.push(`deleteFile:${relativePath}`);
  }

  readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    return this.inner.readDirectory(relativeDirectoryPath);
  }

  stat(relativePath: string): Promise<FileStats | null> {
    return this.inner.stat(relativePath);
  }

  exists(relativePath: string): Promise<boolean> {
    return this.inner.exists(relativePath);
  }
}

describe('planReversal', () => {
  it('builds restore actions for modified text files', async (context) => {
    const harness = await createHarness(context);
    const row = textRow('src/a.ts', 'export const a = 1;\n', 'export const a = 2;\n');
    commitRows(harness, SESSION_ID, [row]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'export const a = 2;\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.sessionId, SESSION_ID);
    assert.equal(plan.targetState, 'pre');
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.actions.length, 1);

    const [action] = plan.actions;
    assert.equal(action.relativePath, 'src/a.ts');
    assert.equal(action.action, 'restore');
    assert.equal(decode(action.targetBytes), 'export const a = 1;\n');
    assert.equal(action.expectedCurrentSha256, row.post_sha256);
    assert.equal(action.actualCurrentSha256, row.post_sha256);
  });

  it('plans deletion for files born inside the session', async (context) => {
    const harness = await createHarness(context);
    const row = textRow('src/new.ts', null, 'brand new\n');
    commitRows(harness, SESSION_ID, [row]);
    await harness.fileSystem.writeAtomic('src/new.ts', 'brand new\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].action, 'delete');
    assert.equal(plan.actions[0].targetBytes, null);
    assert.equal(plan.actions[0].expectedCurrentSha256, row.post_sha256);
  });

  it('treats the zero digest as a born-in-session baseline', async (context) => {
    const harness = await createHarness(context);
    const row = textRow('src/zero.ts', null, 'zero\n');
    const zeroRow: SessionFileInsertRow = { ...row, pre_sha256: '0'.repeat(64) };
    commitRows(harness, SESSION_ID, [zeroRow]);
    await harness.fileSystem.writeAtomic('src/zero.ts', 'zero\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.actions[0].action, 'delete');
    assert.equal(plan.actions[0].targetBytes, null);
  });

  it('restores text deleted by the session', async (context) => {
    const harness = await createHarness(context);
    const row = textRow('src/gone.ts', 'line one\nline two\n', null);
    commitRows(harness, SESSION_ID, [row]);
    assert.equal(await harness.fileSystem.exists('src/gone.ts'), false);

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, true);
    assert.equal(plan.actions[0].action, 'restore');
    assert.equal(decode(plan.actions[0].targetBytes), 'line one\nline two\n');
    assert.equal(plan.actions[0].actualCurrentSha256, null);
    assert.equal(plan.actions[0].expectedCurrentSha256, '');
  });

  it('detects stale baselines when a file changed after the session', async (context) => {
    const harness = await createHarness(context);
    const row = textRow('src/a.ts', 'before\n', 'after\n');
    commitRows(harness, SESSION_ID, [row]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'tampered elsewhere\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, false);
    assert.equal(plan.conflicts.length, 1);
    const [conflict] = plan.conflicts;
    assert.equal(conflict.relativePath, 'src/a.ts');
    assert.equal(conflict.code, 'STALE_BASELINE_CONFLICT');
    assert.equal(conflict.expectedSha256, row.post_sha256);
    assert.equal(conflict.actualSha256, sha256(Buffer.from('tampered elsewhere\n', 'utf8')));
    assert.match(conflict.message, /does not match/u);

    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].actualCurrentSha256, conflict.actualSha256);
  });

  it('reads binary baseline bytes from the content-addressed store', async (context) => {
    const harness = await createHarness(context);
    const preBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
    const postBytes = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, 0x01, 0xfe]);
    const preDigest = sha256(preBytes);

    await harness.fileSystem.writeAtomic(casBlobPath(preDigest), preBytes);
    commitRows(harness, SESSION_ID, [
      binaryRow('assets/archive.bin', preBytes, postBytes, preDigest),
    ]);
    await harness.fileSystem.writeAtomic('assets/archive.bin', postBytes);

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.actions[0].action, 'restore');
    assert.deepEqual(
      Array.from(plan.actions[0].targetBytes ?? new Uint8Array()),
      Array.from(preBytes),
    );
  });

  it('reports BLOB_NOT_FOUND when the recorded blob is missing', async (context) => {
    const harness = await createHarness(context);
    const preBytes = Uint8Array.from([0x00, 0x01]);
    const postBytes = Uint8Array.from([0x00, 0x02]);
    const missingDigest = sha256(preBytes);

    commitRows(harness, SESSION_ID, [
      binaryRow('assets/missing.bin', preBytes, postBytes, missingDigest),
    ]);
    await harness.fileSystem.writeAtomic('assets/missing.bin', postBytes);

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, false);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].code, 'BLOB_NOT_FOUND');
    assert.equal(plan.conflicts[0].expectedSha256, missingDigest);
    assert.equal(plan.actions[0].targetBytes, null);
  });

  it('never writes to the filesystem while planning', async (context) => {
    const harness = await createHarness(context);
    commitRows(harness, SESSION_ID, [
      textRow('src/a.ts', 'before\n', 'after\n'),
      textRow('src/new.ts', null, 'created\n'),
      textRow('src/gone.ts', 'removed\n', null),
    ]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'after\n');
    await harness.fileSystem.writeAtomic('src/new.ts', 'created\n');

    const guarded = new WriteGuardFileSystem(harness.fileSystem);

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: guarded,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, true);
    assert.equal(plan.actions.length, 3);
    assert.deepEqual(guarded.writeCalls, []);
  });

  it('restores forward when targeting the post state', async (context) => {
    const harness = await createHarness(context);
    const row = textRow('src/a.ts', 'before\n', 'after\n');
    commitRows(harness, SESSION_ID, [row]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'before\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
      options: { targetState: 'post' },
    });

    assert.equal(plan.targetState, 'post');
    assert.equal(plan.isExecutable, true);
    assert.equal(plan.actions[0].action, 'restore');
    assert.equal(decode(plan.actions[0].targetBytes), 'after\n');
    assert.equal(plan.actions[0].expectedCurrentSha256, row.pre_sha256);
  });

  it('returns an executable empty plan for sessions without files', async (context) => {
    const harness = await createHarness(context);
    harness.ledger.createSession(sessionRow(SESSION_ID));

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });

    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.actions, []);
    assert.deepEqual(plan.conflicts, []);
  });

  it('throws SessionNotFoundError for unknown sessions', async (context) => {
    const harness = await createHarness(context);

    await assert.rejects(
      planReversal({
        ledger: harness.ledger,
        fileSystem: harness.fileSystem,
        sessionId: 'BR-20260301-999',
      }),
      (error: unknown) => error instanceof SessionNotFoundError,
    );
  });

  for (const status of ['reverted', 'aborted'] as const) {
    it(`refuses to plan for ${status} sessions`, async (context) => {
      const harness = await createHarness(context);
      const session: SessionInsertRow = { ...sessionRow(SESSION_ID), status };
      harness.ledger.createSession(session);

      await assert.rejects(
        planReversal({
          ledger: harness.ledger,
          fileSystem: harness.fileSystem,
          sessionId: SESSION_ID,
        }),
        (error: unknown) => error instanceof SessionNotRevertibleError
          && error.status === status,
      );
    });
  }
});
