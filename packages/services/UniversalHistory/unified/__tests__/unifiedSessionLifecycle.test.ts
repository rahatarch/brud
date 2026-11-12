import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import {
  DEFAULT_TRASH_RETENTION_MS,
  UnifiedHistoryService,
  UnifiedHistoryStore,
  UnifiedWipeConfirmationError,
  WIPE_CONFIRMATION_PHRASE,
} from '../index.js';

interface Harness {
  readonly service: UnifiedHistoryService;
  readonly store: UnifiedHistoryStore;
}

async function harness(context: TestContext, trashRetentionMs?: number): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-unified-lifecycle-')));
  const driver = new DurableNodeStorageDriver();
  const journal = createFileMutationJournal();
  const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
  await fs.initialize();
  const store = new UnifiedHistoryStore({ dbPath: ':memory:', historyRoot: join(root, '.brud/history'), driver });
  const service = new UnifiedHistoryService({
    store,
    fileSystem: () => fs,
    journal,
    ...(trashRetentionMs === undefined ? {} : { trashRetentionMs }),
  });
  await service.start();
  context.after(async () => {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return { service, store };
}

async function completedSession(h: Harness, prompt: string): Promise<string> {
  const sessionId = await h.service.beginSession(prompt, { declaredTargets: [] });
  await h.service.commitSession(sessionId, 'completed');
  return sessionId;
}

describe('UnifiedHistoryService — trash and restore', () => {
  it('moves a session to the trash, hides it from listSessions, and restores it', async (context) => {
    const h = await harness(context);
    const sessionId = await completedSession(h, 'trash me');
    const base = Date.now();

    assert.deepEqual(h.service.listSessions().rows.map((row) => row.sessionId), [sessionId]);

    const trashed = h.service.trashSession(sessionId, { now: base });

    assert.equal(trashed.session.isDeleted, true);
    assert.equal(trashed.expiresAt, base + DEFAULT_TRASH_RETENTION_MS);
    assert.deepEqual(h.service.listSessions().rows, []);
    assert.deepEqual(h.service.listSessions({ includeDeleted: true }).rows.map((row) => row.sessionId), [sessionId]);
    assert.deepEqual(h.service.listTrashedSessions().rows.map((row) => row.sessionId), [sessionId]);
    assert.equal(h.store.getSession(sessionId)?.isDeleted, true);

    const restored = h.service.restoreSession(sessionId, { now: base + 1 });

    assert.equal(restored.session.isDeleted, false);
    assert.equal(restored.expiresAt, null);
    assert.deepEqual(h.service.listSessions().rows.map((row) => row.sessionId), [sessionId]);
    assert.deepEqual(h.service.listTrashedSessions().rows, []);

    const audit = h.service.listDeleteHistory({ sessionId }).rows;
    assert.deepEqual(audit.map((row) => [row.action, row.status]), [
      ['restore', 'success'],
      ['trash', 'success'],
    ]);
    assert.ok(audit.every((row) => row.actor === 'user'));
  });

  it('persists the trash state across a service restart', async (context) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-unified-lifecycle-restart-')));
    context.after(() => rm(root, { recursive: true, force: true }));
    const driver = new DurableNodeStorageDriver();
    const journal = createFileMutationJournal();
    const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
    await fs.initialize();
    const dbPath = join(root, '.brud/history/universal.db');
    const historyRoot = join(root, '.brud/history');

    const firstStore = new UnifiedHistoryStore({ dbPath, historyRoot, driver });
    const first = new UnifiedHistoryService({ store: firstStore, fileSystem: () => fs, journal });
    await first.start();
    const sessionId = await first.beginSession('restart', { declaredTargets: [] });
    await first.commitSession(sessionId, 'completed');
    first.trashSession(sessionId);
    await first.dispose();

    const secondStore = new UnifiedHistoryStore({ dbPath, historyRoot, driver });
    const second = new UnifiedHistoryService({ store: secondStore, fileSystem: () => fs, journal });
    await second.start();
    context.after(() => second.dispose());

    assert.deepEqual(second.listSessions().rows.map((row) => row.sessionId), []);
    assert.deepEqual(second.listTrashedSessions().rows.map((row) => row.sessionId), [sessionId]);
    second.restoreSession(sessionId);
    assert.deepEqual(second.listSessions().rows.map((row) => row.sessionId), [sessionId]);
  });

  it('refuses to trash an active session', async (context) => {
    const h = await harness(context);
    const sessionId = await h.service.beginSession('still active', { declaredTargets: [] });

    assert.throws(() => h.service.trashSession(sessionId), /Cannot trash session/u);

    const audit = h.service.listDeleteHistory({ sessionId }).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, 'trash');
    assert.equal(audit[0]?.status, 'failed');
  });
});

describe('UnifiedHistoryService — permanent delete', () => {
  it('removes the session and its rows while keeping the delete-history audit', async (context) => {
    const h = await harness(context);
    const sessionId = await completedSession(h, 'delete me');
    const base = Date.now();
    h.service.trashSession(sessionId, { now: base });

    const receipt = h.service.deleteSessionPermanently(sessionId, { now: base + 1 });

    assert.equal(receipt.sessionId, sessionId);
    assert.equal(h.store.getSession(sessionId), undefined);
    assert.deepEqual(h.service.listSessions({ includeDeleted: true }).rows, []);
    assert.deepEqual(h.service.listTrashedSessions().rows, []);

    const audit = h.service.listDeleteHistory({ sessionId }).rows;
    assert.deepEqual(audit.map((row) => row.action), ['delete', 'trash']);
    assert.equal(audit[0]?.status, 'success');
    assert.equal((audit[0]?.details as { wasTrashed?: boolean }).wasTrashed, true);
  });
});

describe('UnifiedHistoryService — wipe', () => {
  it('requires the exact phrase, logs a failed attempt, then wipes permanently', async (context) => {
    const h = await harness(context);
    const first = await completedSession(h, 'first');
    const second = await completedSession(h, 'second');
    const base = Date.now();
    h.service.trashSession(second, { now: base });

    await assert.rejects(
      () => h.service.wipeAllSessions('delete everything', { now: base + 1 }),
      UnifiedWipeConfirmationError,
    );

    assert.deepEqual(
      h.service.listSessions({ includeDeleted: true }).rows.map((row) => row.sessionId).sort(),
      [first, second].sort(),
    );
    const failed = h.service.listDeleteHistory({ action: 'wipe' }).rows;
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.status, 'failed');
    assert.deepEqual(failed[0]?.details, {
      attemptedPhrase: 'delete everything',
      expectedPhrase: WIPE_CONFIRMATION_PHRASE,
    });

    const receipt = await h.service.wipeAllSessions(WIPE_CONFIRMATION_PHRASE, { now: base + 2 });

    assert.ok(receipt.sessionIds.includes(first));
    assert.ok(receipt.sessionIds.includes(second));
    assert.equal(receipt.deletedCount, receipt.sessionIds.length);
    assert.deepEqual(h.service.listSessions().rows, []);
    assert.deepEqual(h.service.listSessions({ includeDeleted: true }).rows, []);
    assert.equal(h.store.getSession(first), undefined);
    assert.equal(h.store.getSession(second), undefined);

    const audit = h.service.listDeleteHistory({ action: 'wipe' }).rows;
    assert.deepEqual(audit.map((row) => row.status), ['success', 'failed']);
    assert.equal((audit[0]?.details as { deletedCount?: number }).deletedCount, receipt.deletedCount);
  });
});

describe('UnifiedHistoryService — trash retention', () => {
  it('permanently deletes trashed sessions whose window elapsed and audits the expiry', async (context) => {
    const h = await harness(context, 1);
    const sessionId = await completedSession(h, 'expire');

    const trashed = h.service.trashSession(sessionId, { now: 1_000 });
    assert.equal(trashed.expiresAt, 1_001);

    const purged = h.service.purgeExpiredTrash(1_002);

    assert.deepEqual(purged.expiredSessionIds, [sessionId]);
    assert.equal(h.store.getSession(sessionId), undefined);
    const audit = h.service.listDeleteHistory({ sessionId }).rows;
    assert.deepEqual(audit.map((row) => [row.action, row.actor]), [
      ['trash_expired', 'system'],
      ['trash', 'user'],
    ]);
  });
});