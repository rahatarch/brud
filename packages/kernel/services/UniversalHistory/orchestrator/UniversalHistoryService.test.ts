import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { SessionNotRevertibleError } from '../operations/plan_reversal/types.js';
import { InactiveSessionError } from '../operations/attach_execution/types.js';
import { IdAllocator } from '../storage/IdAllocator/IdAllocator.js';
import { SqliteLedger } from '../storage/SqliteLedger/index.js';
import {
  SessionStateUnavailableError,
  UniversalHistoryService,
} from './UniversalHistoryService.js';

const WORKSPACE_ROOT = '/workspace';
const TEXT_PATH = 'src/app.ts';
const BINARY_PATH = 'assets/icon.bin';
const CREATED_PATH = 'src/created.ts';
const TEXT_BEFORE = 'export const value = 1;\n';
const TEXT_AFTER = 'export const value = 2;\n';
const BINARY_BEFORE = Uint8Array.from([0x00, 0x01, 0x02, 0xff]);
const BINARY_AFTER = Uint8Array.from([0x00, 0x09, 0x08, 0xfe]);

interface Harness {
  readonly service: UniversalHistoryService;
  readonly fileSystem: BrudFileSystem;
  readonly ledger: SqliteLedger;
  readonly driver: InMemoryStorageDriver;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytesOf(value: Uint8Array): readonly number[] {
  return Array.from(value);
}

async function createHarness(context: TestContext): Promise<Harness> {
  const driver = new InMemoryStorageDriver();
  const fileSystem = new BrudFileSystem(WORKSPACE_ROOT, driver);
  await fileSystem.initialize();

  const ledger = new SqliteLedger({ dbPath: ':memory:' });
  const idAllocator = new IdAllocator(fileSystem, {
    now: (): Date => new Date('2026-05-01T09:00:00.000Z'),
  });
  let tick = 0;
  const service = new UniversalHistoryService({
    ledger,
    fileSystem,
    idAllocator,
    now: (): Date => new Date(Date.parse('2026-05-01T10:00:00.000Z') + tick * 1_000),
  });

  context.after(() => {
    service.dispose();
  });

  return { service, fileSystem, ledger, driver };
}

describe('UniversalHistoryService', () => {
  it('runs the full baseline, commit, and reversal lifecycle', async (context) => {
    const { service, fileSystem, ledger } = await createHarness(context);

    await fileSystem.writeAtomic(TEXT_PATH, TEXT_BEFORE);
    await fileSystem.writeAtomic(BINARY_PATH, BINARY_BEFORE);

    const sessionId = await service.beginSession('Edit text and binary targets', [
      TEXT_PATH,
      BINARY_PATH,
      CREATED_PATH,
    ]);

    assert.match(sessionId, /^BR-20260501-001$/u);

    await fileSystem.writeAtomic(TEXT_PATH, TEXT_AFTER);
    await fileSystem.writeAtomic(BINARY_PATH, BINARY_AFTER);
    await fileSystem.writeAtomic(CREATED_PATH, 'export const created = true;\n');

    const receipt = await service.commitSession(sessionId, 'completed');

    assert.equal(receipt.sessionId, sessionId);
    assert.equal(receipt.committedFileCount, 3);
    assert.equal(receipt.blobs.length, 1);

    const stored = ledger.getSession(sessionId);
    assert.ok(stored !== null);
    assert.equal(stored.session.status, 'committed');
    assert.equal(stored.files.length, 3);

    const textRow = stored.files.find((row) => row.relative_path === TEXT_PATH);
    assert.ok(textRow !== undefined);
    assert.equal(textRow.is_binary, 0);
    assert.equal(textRow.pre_sha256, sha256(Buffer.from(TEXT_BEFORE)));
    assert.equal(textRow.post_sha256, sha256(Buffer.from(TEXT_AFTER)));
    assert.match(textRow.diff_content ?? '', /\+export const value = 2;/u);

    const binaryRow = stored.files.find((row) => row.relative_path === BINARY_PATH);
    assert.ok(binaryRow !== undefined);
    assert.equal(binaryRow.is_binary, 1);
    assert.equal(binaryRow.post_sha256, sha256(BINARY_AFTER));
    assert.equal(binaryRow.blob_sha256, sha256(BINARY_AFTER));
    assert.equal(binaryRow.diff_content, null);

    const manifest = await service.getSession(sessionId);
    assert.ok(manifest !== null);
    assert.equal(manifest.status, 'committed');
    assert.deepEqual(
      [...manifest.filesAffected].sort(),
      [BINARY_PATH, CREATED_PATH, TEXT_PATH].sort(),
    );
    assert.equal(manifest.preDigests[TEXT_PATH]?.sha256, sha256(Buffer.from(TEXT_BEFORE)));
    assert.equal(manifest.postDigests[TEXT_PATH]?.sha256, sha256(Buffer.from(TEXT_AFTER)));

    const plan = await service.planReversal(sessionId);

    assert.equal(plan.targetState, 'pre');
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.actions.length, 3);

    const reversal = await service.executeReversal(plan);

    assert.equal(reversal.sessionId, sessionId);
    assert.equal(reversal.targetState, 'pre');
    assert.equal(reversal.filesRestored, 2);
    assert.equal(reversal.filesDeleted, 1);

    assert.equal(await fileSystem.readText(TEXT_PATH), TEXT_BEFORE);
    assert.deepEqual(bytesOf(await fileSystem.readFile(BINARY_PATH)), bytesOf(BINARY_BEFORE));
    assert.equal(await fileSystem.exists(CREATED_PATH), false);

    const reverted = ledger.getSession(sessionId);
    assert.ok(reverted !== null);
    assert.equal(reverted.session.status, 'reverted');
    assert.equal(reverted.files.length, 3);

    const revertedManifest = await service.getSession(sessionId);
    assert.ok(revertedManifest !== null);
    assert.equal(revertedManifest.status, 'reverted');
    assert.equal(revertedManifest.revertRecordIds?.length, 1);
  });

  it('lists durable sessions and applies filters', async (context) => {
    const { service } = await createHarness(context);

    const completed = await service.beginSession('Completed session');
    await service.commitSession(completed, 'completed');

    const aborted = await service.beginSession('Aborted session');
    await service.commitSession(aborted, 'aborted');

    const all = await service.listSessions();
    assert.equal(all.length, 2);

    const onlyAborted = await service.listSessions({ status: 'aborted' });
    assert.deepEqual(onlyAborted.map((row) => row.session_id), [aborted]);

    const limited = await service.listSessions({ limit: 1 });
    assert.equal(limited.length, 1);
  });

  it('closes aborted sessions without persisting file rows', async (context) => {
    const { service, fileSystem, ledger } = await createHarness(context);

    await fileSystem.writeAtomic('src/aborted.ts', 'before\n');
    const sessionId = await service.beginSession('Abort this session', ['src/aborted.ts']);
    await fileSystem.writeAtomic('src/aborted.ts', 'after\n');

    const receipt = await service.commitSession(sessionId, 'aborted');

    assert.equal(receipt.committedFileCount, 0);
    assert.deepEqual(receipt.blobs, []);

    const stored = ledger.getSession(sessionId);
    assert.ok(stored !== null);
    assert.equal(stored.session.status, 'aborted');
    assert.deepEqual(stored.files, []);

    await assert.rejects(
      () => service.planReversal(sessionId),
      (error: unknown) => error instanceof SessionNotRevertibleError,
    );

    await assert.rejects(
      () => service.commitSession(sessionId, 'completed'),
      (error: unknown) => error instanceof InactiveSessionError,
    );
  });

  it('reports a missing live baseline for active sessions that predate the process', async (context) => {
    const { ledger, fileSystem } = await createHarness(context);
    const stateLess = new UniversalHistoryService({ ledger, fileSystem });

    ledger.createSession({
      session_id: 'BR-20260501-900',
      created_at: '2026-05-01T09:00:00.000Z',
      prompt: 'restored from disk',
      status: 'active',
      files_affected: '[]',
    });

    await assert.rejects(
      () => stateLess.commitSession('BR-20260501-900', 'completed'),
      (error: unknown) => error instanceof SessionStateUnavailableError,
    );
  });

  it('returns null for unknown sessions', async (context) => {
    const { service } = await createHarness(context);

    assert.equal(await service.getSession('BR-20260501-404'), null);
  });

  it('rejects commits for unknown sessions', async (context) => {
    const { service } = await createHarness(context);

    await assert.rejects(
      () => service.commitSession('BR-20260501-999', 'completed'),
      /Session not found/u,
    );
  });
});
