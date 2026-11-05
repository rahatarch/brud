/**
 * Directory-state digest safety.
 *
 * Session targets record one digest per state. Directories have no bytes, so
 * they use `DIRECTORY_STATE_SHA256`, which is a valid 64-hex digest. That means
 * the digest alone is not collision-proof: a real file could in principle hash
 * to the same value. Safety is therefore structural. A directory is exactly
 * `(DIRECTORY_STATE_SHA256, size 0)`; any file carrying that digest must be
 * non-empty (`sha256("")` is a different constant), so it classifies as a file
 * and its bytes are restored instead of a directory being created.
 *
 * A real SHA-256 preimage of the marker cannot be constructed, so the engine
 * collision test stubs the content store at the same boundary a real collision
 * would cross: the planned state is exactly `(marker, non-zero size)`.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { DurableNodeStorageDriver } from '../../../BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { LegacySessionAdapter } from '../compat/LegacySessionAdapter.js';
import { ReversalEngine } from '../engine/ReversalEngine.js';
import { CORE_NAMESPACE, UnifiedHistoryService } from '../service/index.js';
import type { SessionTargetPayload } from '../service/builtinTypes.js';
import { DIRECTORY_STATE_SHA256, classifyTargetState } from '../service/targets.js';
import { UnifiedHistoryStore, sha256Hex } from '../store/index.js';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array | null): string | null =>
  value === null ? null : new TextDecoder().decode(value);
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** Simulated bytes for a file that hashes to the reserved directory digest. */
const COLLIDING_BYTES = text('colliding file content\n');

/**
 * A real SHA-256 preimage of the marker is infeasible to construct. The engine
 * only cross-examines the store through `getContent`, so this subclass supplies
 * the bytes the CAS would return for a genuinely colliding file.
 */
class CollidingStore extends UnifiedHistoryStore {
  override async getContent(sha256: string): Promise<Uint8Array> {
    if (sha256 === DIRECTORY_STATE_SHA256) {
      return COLLIDING_BYTES;
    }
    return await super.getContent(sha256);
  }
}

interface Harness {
  readonly service: UnifiedHistoryService;
  readonly engine: ReversalEngine;
  readonly fs: BrudFileSystem;
  readonly store: UnifiedHistoryStore;
}

async function harness(context: TestContext, colliding = false): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-directory-digest-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  const driver = new DurableNodeStorageDriver();
  const journal = createFileMutationJournal();
  const fs = new BrudFileSystem(root, driver, { mutationJournal: journal });
  await fs.initialize();
  const options = {
    dbPath: ':memory:',
    historyRoot: join(root, '.brud/history'),
    driver,
  };
  const store = colliding ? new CollidingStore(options) : new UnifiedHistoryStore(options);
  const service = new UnifiedHistoryService({ store, fileSystem: () => fs, journal });
  await service.start();
  context.after(() => service.dispose());
  const engine = new ReversalEngine({ service, fileSystem: () => fs });
  return { service, engine, fs, store };
}

async function targetPayload(h: Harness, sessionId: string): Promise<SessionTargetPayload> {
  const rows = h.store.listEntries({
    sessionId,
    namespace: CORE_NAMESPACE,
    type: 'session-target',
    order: 'asc',
  }).rows;
  assert.equal(rows.length, 1, 'exactly one changed session target');
  return await h.service.resolvePayload(rows[0]!) as SessionTargetPayload;
}

describe('DIRECTORY_STATE_SHA256 — collision safety', () => {
  it('pins the reserved digest and classifies it by node size, not digest alone', () => {
    assert.equal(
      DIRECTORY_STATE_SHA256,
      '6fdda86b4885b7c3ee174f8dc7f649276c6b4fec8d368eb0e968dafaa4be2424',
    );
    assert.match(DIRECTORY_STATE_SHA256, SHA256_HEX);

    // A colliding file cannot be empty: the empty-file digest is different, so
    // every real file carrying the marker necessarily has a non-zero size.
    assert.notEqual(sha256Hex(text('')), DIRECTORY_STATE_SHA256);
    assert.equal(classifyTargetState(DIRECTORY_STATE_SHA256, 0), 'directory');
    assert.equal(classifyTargetState(DIRECTORY_STATE_SHA256, 1), 'file');
    assert.equal(classifyTargetState(DIRECTORY_STATE_SHA256, COLLIDING_BYTES.byteLength), 'file');
    assert.equal(classifyTargetState(null, 0), 'missing');
    assert.equal(classifyTargetState(sha256Hex(text('ordinary')), 8), 'file');
  });

  it('captures a real file with its content digest, never the directory marker', async (context) => {
    const h = await harness(context);
    await h.fs.createDirectory('tree');
    // A file whose content is the marker text still hashes to a normal digest.
    await h.fs.writeAtomic('tree/marker.txt', DIRECTORY_STATE_SHA256);

    const bytes = text(DIRECTORY_STATE_SHA256);
    const expectedDigest = sha256Hex(bytes);
    assert.notEqual(expectedDigest, DIRECTORY_STATE_SHA256);

    const id = await h.service.beginSession('capture marker-like file', {
      declaredTargets: ['tree/marker.txt'],
    });
    const baseline = h.service.getSessionView(id)?.baseline['tree/marker.txt'];
    assert.equal(baseline?.exists, true);
    assert.equal(baseline?.sha256, expectedDigest);
    assert.match(baseline?.sha256 ?? '', SHA256_HEX);
    assert.notEqual(baseline?.sha256, DIRECTORY_STATE_SHA256);
    assert.equal(classifyTargetState(baseline?.sha256 ?? null, baseline?.size ?? 0), 'file');

    await h.fs.writeAtomic('tree/marker.txt', 'changed');
    await h.service.commitSession(id, 'completed');

    const payload = await targetPayload(h, id);
    assert.equal(payload.preSha256, expectedDigest);
    assert.equal(payload.postSha256, sha256Hex(text('changed')));
    assert.notEqual(payload.preSha256, DIRECTORY_STATE_SHA256);
    assert.notEqual(payload.postSha256, DIRECTORY_STATE_SHA256);

    // Reversal restores bytes: it must not perform a directory create.
    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.fileActions.map((action) => [action.path, action.action]), [
      ['tree/marker.txt', 'restore'],
    ]);
    assert.equal(decode(plan.fileActions[0]!.targetBytes), DIRECTORY_STATE_SHA256);
    assert.ok(plan.fileActions.every((action) => action.action !== 'mkdir' && action.action !== 'rmdir'));

    await h.engine.executeSessionReversal(plan);
    assert.equal(await h.fs.readText('tree/marker.txt'), DIRECTORY_STATE_SHA256);
  });

  it('restores file content when a file digest equals the reserved digest', async (context) => {
    const h = await harness(context, true);
    await h.fs.createDirectory('tree');

    // Record the exact state a genuinely colliding file would produce: the
    // reserved digest with a non-zero size, deleted by the session.
    const id = await h.service.beginSession('simulated digest collision');
    await h.service.recordEntry(CORE_NAMESPACE, id, {
      type: 'session-target',
      schemaVersion: 1,
      payload: {
        path: 'tree/collision.txt',
        preSha256: DIRECTORY_STATE_SHA256,
        postSha256: null,
        preSize: COLLIDING_BYTES.byteLength,
        postSize: 0,
        isBinary: false,
      },
    });
    await h.service.commitSession(id, 'completed');

    const payload = await targetPayload(h, id);
    assert.equal(payload.preSha256, DIRECTORY_STATE_SHA256);
    assert.equal(classifyTargetState(payload.preSha256, payload.preSize), 'file');

    const plan = await h.engine.planSessionReversal(id);
    assert.equal(plan.isExecutable, true);
    assert.deepEqual(plan.fileActions.map((action) => [action.path, action.action]), [
      ['tree/collision.txt', 'restore'],
    ]);
    assert.equal(plan.fileActions[0]!.expectedCurrentKind, 'missing');
    assert.equal(decode(plan.fileActions[0]!.targetBytes), decode(COLLIDING_BYTES));
    assert.ok(plan.fileActions.every((action) => action.action !== 'mkdir'));

    await h.engine.executeSessionReversal(plan);
    assert.equal(await h.fs.readText('tree/collision.txt'), decode(COLLIDING_BYTES));
  });

  it('treats a deleted directory as a directory: restores it with mkdir', async (context) => {
    const h = await harness(context);
    await h.fs.createDirectory('tree');
    await h.fs.createDirectory('tree/dir');

    const id = await h.service.beginSession('remove a directory', {
      declaredTargets: ['tree/dir'],
    });
    await h.fs.deleteDirectory('tree/dir');
    await h.service.commitSession(id, 'completed');

    const payload = await targetPayload(h, id);
    assert.equal(payload.preSha256, DIRECTORY_STATE_SHA256);
    assert.equal(payload.postSha256, null);
    assert.equal(classifyTargetState(payload.preSha256, payload.preSize), 'directory');

    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.fileActions.map((action) => [action.path, action.action]), [
      ['tree/dir', 'mkdir'],
    ]);
    assert.equal(plan.fileActions[0]!.targetBytes, null);

    const receipt = await h.engine.executeSessionReversal(plan);
    assert.equal(receipt.status, 'success');
    const restored = await h.fs.stat('tree/dir');
    assert.equal(restored?.isDirectory, true);
  });

  it('treats a created directory as a directory: removes it with rmdir', async (context) => {
    const h = await harness(context);
    await h.fs.createDirectory('tree');

    const id = await h.service.beginSession('create a directory', {
      declaredTargets: ['tree/created'],
    });
    await h.fs.createDirectory('tree/created');
    await h.service.commitSession(id, 'completed');

    const payload = await targetPayload(h, id);
    assert.equal(payload.preSha256, null);
    assert.equal(payload.postSha256, DIRECTORY_STATE_SHA256);
    assert.equal(classifyTargetState(payload.postSha256, payload.postSize), 'directory');
    assert.equal((await h.fs.stat('tree/created'))?.isDirectory, true);

    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.fileActions.map((action) => [action.path, action.action]), [
      ['tree/created', 'rmdir'],
    ]);

    await h.engine.executeSessionReversal(plan);
    assert.equal(await h.fs.stat('tree/created'), null);
  });

  it('treats a created file as a file: removes it with delete, not rmdir', async (context) => {
    const h = await harness(context);
    await h.fs.createDirectory('tree');

    const id = await h.service.beginSession('create a file', {
      declaredTargets: ['tree/new.txt'],
    });
    await h.fs.writeAtomic('tree/new.txt', 'new');
    await h.service.commitSession(id, 'completed');

    const payload = await targetPayload(h, id);
    assert.equal(payload.preSha256, null);
    assert.equal(payload.postSha256, sha256Hex(text('new')));
    assert.notEqual(payload.postSha256, DIRECTORY_STATE_SHA256);
    assert.equal(classifyTargetState(payload.postSha256, payload.postSize), 'file');

    const plan = await h.engine.planSessionReversal(id);
    assert.deepEqual(plan.fileActions.map((action) => [action.path, action.action]), [
      ['tree/new.txt', 'delete'],
    ]);

    await h.engine.executeSessionReversal(plan);
    assert.equal(await h.fs.exists('tree/new.txt'), false);
  });

  it('maps directory actions into the legacy public vocabulary', async (context) => {
    const h = await harness(context);
    const adapter = new LegacySessionAdapter(h.service, h.engine);
    await h.fs.createDirectory('tree');
    await h.fs.createDirectory('tree/deleted');

    const removed = await h.service.beginSession('legacy remove', {
      declaredTargets: ['tree/deleted'],
    });
    await h.fs.deleteDirectory('tree/deleted');
    await h.service.commitSession(removed, 'completed');

    const created = await h.service.beginSession('legacy create', {
      declaredTargets: ['tree/created'],
    });
    await h.fs.createDirectory('tree/created');
    await h.service.commitSession(created, 'completed');

    const removePlan = await adapter.planReversal(removed);
    assert.deepEqual(removePlan.actions.map((action) => [action.relativePath, action.action]), [
      ['tree/deleted', 'restore'],
    ]);
    assert.equal(removePlan.actions[0]!.targetBytes, null);

    const createPlan = await adapter.planReversal(created);
    assert.deepEqual(createPlan.actions.map((action) => [action.relativePath, action.action]), [
      ['tree/created', 'delete'],
    ]);
  });
});