import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { SqliteLedger } from '../../storage/SqliteLedger/SqliteLedger.js';
import type {
  SessionFileInsertRow,
  SessionInsertRow,
} from '../../storage/SqliteLedger/types.js';
import { createUnifiedDiff } from '../compute_delta/computeDelta.js';
import { planReversal } from '../plan_reversal/planReversal.js';
import type { ReversalPlan } from '../plan_reversal/types.js';
import { executeReversal } from './executeReversal.js';
import {
  MissingReversalBytesError,
  ReversalConflictError,
} from './types.js';

const SESSION_ID = 'BR-20260302-001';
const CREATED_AT = '2026-03-02T09:00:00.000Z';

interface Harness {
  readonly ledger: SqliteLedger;
  readonly fileSystem: BrudFileSystem;
}

async function createHarness(context: TestContext): Promise<Harness> {
  const ledger = new SqliteLedger({ dbPath: ':memory:' });
  context.after(() => ledger.close());

  const fileSystem = new BrudFileSystem('/workspace', new InMemoryStorageDriver());
  await fileSystem.initialize();

  return { ledger, fileSystem };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sessionRow(sessionId: string): SessionInsertRow {
  return {
    session_id: sessionId,
    created_at: CREATED_AT,
    prompt: 'reversal execution',
    status: 'active',
    files_affected: '[]',
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

function commitRows(
  harness: Harness,
  sessionId: string,
  rows: readonly SessionFileInsertRow[],
): void {
  harness.ledger.createSession(sessionRow(sessionId));
  harness.ledger.commitSession(sessionId, rows);
}

describe('executeReversal', () => {
  it('restores previous contents and deletes born-in-session files', async (context) => {
    const harness = await createHarness(context);
    commitRows(harness, SESSION_ID, [
      textRow('src/a.ts', 'before\n', 'after\n'),
      textRow('src/new.ts', null, 'brand new\n'),
    ]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'after\n');
    await harness.fileSystem.writeAtomic('src/new.ts', 'brand new\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });
    assert.equal(plan.isExecutable, true);

    const receipt = await executeReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      plan,
    });

    assert.equal(receipt.sessionId, SESSION_ID);
    assert.equal(receipt.targetState, 'pre');
    assert.match(receipt.reversalId, /^REV-\d+-[0-9a-f]{8}$/u);
    assert.equal(Number.isNaN(Date.parse(receipt.executedAt)), false);
    assert.equal(receipt.filesRestored, 1);
    assert.equal(receipt.filesDeleted, 1);

    assert.equal(await harness.fileSystem.readText('src/a.ts'), 'before\n');
    assert.equal(await harness.fileSystem.exists('src/new.ts'), false);
  });

  it('records the reversal and marks the session reverted', async (context) => {
    const harness = await createHarness(context);
    commitRows(harness, SESSION_ID, [textRow('src/a.ts', 'before\n', 'after\n')]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'after\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });
    const receipt = await executeReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      plan,
    });

    const reversals = harness.ledger.getReversalsForSession(SESSION_ID);
    assert.equal(reversals.length, 1);
    assert.equal(reversals[0].reversal_id, receipt.reversalId);
    assert.equal(reversals[0].session_id, SESSION_ID);
    assert.equal(reversals[0].target_state, 'pre');
    assert.equal(reversals[0].status, 'success');
    assert.equal(reversals[0].error_message, null);
    assert.deepEqual(JSON.parse(reversals[0].reverted_operations), ['src/a.ts']);

    const session = harness.ledger.getSession(SESSION_ID);
    assert.ok(session);
    assert.equal(session.session.status, 'reverted');
  });

  it('refuses to execute a plan with conflicts', async (context) => {
    const harness = await createHarness(context);
    commitRows(harness, SESSION_ID, [textRow('src/a.ts', 'before\n', 'after\n')]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'tampered\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
    });
    assert.equal(plan.isExecutable, false);

    await assert.rejects(
      executeReversal({
        ledger: harness.ledger,
        fileSystem: harness.fileSystem,
        plan,
      }),
      (error: unknown) => error instanceof ReversalConflictError
        && error.conflicts.length === 1,
    );

    assert.equal(await harness.fileSystem.readText('src/a.ts'), 'tampered\n');
    assert.deepEqual(harness.ledger.getReversalsForSession(SESSION_ID), []);

    const session = harness.ledger.getSession(SESSION_ID);
    assert.ok(session);
    assert.equal(session.session.status, 'committed');
  });

  it('rejects inconsistent plans that claim executability despite conflicts', async (context) => {
    const harness = await createHarness(context);
    harness.ledger.createSession(sessionRow(SESSION_ID));

    const plan: ReversalPlan = {
      sessionId: SESSION_ID,
      targetState: 'pre',
      actions: [],
      conflicts: [
        {
          relativePath: 'src/a.ts',
          code: 'STALE_BASELINE_CONFLICT',
          message: 'stale',
          expectedSha256: 'a'.repeat(64),
          actualSha256: 'b'.repeat(64),
        },
      ],
      isExecutable: true,
    };

    await assert.rejects(
      executeReversal({
        ledger: harness.ledger,
        fileSystem: harness.fileSystem,
        plan,
      }),
      (error: unknown) => error instanceof ReversalConflictError,
    );
  });

  it('rejects restore actions without target bytes', async (context) => {
    const harness = await createHarness(context);
    harness.ledger.createSession(sessionRow(SESSION_ID));
    await harness.fileSystem.writeAtomic('src/a.ts', 'keep\n');

    const plan: ReversalPlan = {
      sessionId: SESSION_ID,
      targetState: 'pre',
      actions: [
        {
          relativePath: 'src/a.ts',
          action: 'restore',
          targetBytes: null,
          expectedCurrentSha256: sha256(Buffer.from('keep\n', 'utf8')),
          actualCurrentSha256: sha256(Buffer.from('keep\n', 'utf8')),
        },
      ],
      conflicts: [],
      isExecutable: true,
    };

    await assert.rejects(
      executeReversal({
        ledger: harness.ledger,
        fileSystem: harness.fileSystem,
        plan,
      }),
      (error: unknown) => error instanceof MissingReversalBytesError,
    );

    assert.equal(await harness.fileSystem.readText('src/a.ts'), 'keep\n');
    assert.deepEqual(harness.ledger.getReversalsForSession(SESSION_ID), []);
  });

  it('applies post-state plans by writing the forward content', async (context) => {
    const harness = await createHarness(context);
    commitRows(harness, SESSION_ID, [textRow('src/a.ts', 'before\n', 'after\n')]);
    await harness.fileSystem.writeAtomic('src/a.ts', 'before\n');

    const plan = await planReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      sessionId: SESSION_ID,
      options: { targetState: 'post' },
    });
    const receipt = await executeReversal({
      ledger: harness.ledger,
      fileSystem: harness.fileSystem,
      plan,
    });

    assert.equal(receipt.targetState, 'post');
    assert.equal(receipt.filesRestored, 1);
    assert.equal(receipt.filesDeleted, 0);
    assert.equal(await harness.fileSystem.readText('src/a.ts'), 'after\n');

    const reversals = harness.ledger.getReversalsForSession(SESSION_ID);
    assert.equal(reversals[0].target_state, 'post');
  });
});
