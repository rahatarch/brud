import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createStandardKernel } from '../../../../src/bootstrap/index.js';
import type { BrudKernel } from '../../../../src/engine/BrudKernel.js';
import type { IBrudPlugin } from '../../../PluginManager/contracts/IBrudPlugin.js';
import type { PluginPermission } from '../../../PluginManager/contracts/permissions.js';
import type { IPluginHistoryService } from '../../contracts/index.js';
import { WIPE_CONFIRMATION_PHRASE } from '../index.js';

interface ProbeState {
  history?: IPluginHistoryService;
}

interface Harness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly writer: IPluginHistoryService;
  readonly reader: IPluginHistoryService;
  shutdown(): Promise<void>;
}

function createProbe(
  id: string,
  permissions: readonly PluginPermission[],
  state: ProbeState,
): IBrudPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      permissions: [...permissions],
    },
    activate(context): void {
      state.history = context.getUniversalHistory();
    },
  };
}

async function boot(context: TestContext): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-plugin-history-')));
  const writeState: ProbeState = {};
  const readState: ProbeState = {};
  const kernel = createStandardKernel({
    history: { inMemory: true },
    certifyInitialPlugins: true,
    initialPlugins: [
      createProbe('akkhar-labs.test.history-write', ['history:write'], writeState),
      createProbe('akkhar-labs.test.history-read', ['history:read'], readState),
    ],
  });

  await kernel.boot({ workspaceRoot: root });

  context.after(async () => {
    await kernel.shutdown();
    await rm(root, { recursive: true, force: true });
  });

  if (writeState.history === undefined || readState.history === undefined) {
    throw new Error('history probes did not receive a plugin history handle');
  }

  return {
    kernel,
    root,
    writer: writeState.history,
    reader: readState.history,
    shutdown: async (): Promise<void> => {
      await kernel.shutdown();
    },
  };
}

function isReadOnlyViolation(error: unknown): boolean {
  return error instanceof Error
    && (error as { readonly code?: string }).code === 'READ_ONLY_VIOLATION';
}

describe('plugin history contract (Phase 3A)', () => {
  it('exposes every Phase 2 method through context.getUniversalHistory()', async (context) => {
    const h = await boot(context);
    const target = 'note.txt';
    const sessionId = await h.writer.beginSession('plugin contract probe', [target]);

    await writeFile(join(h.root, target), 'hello');

    await h.writer.commitSession(sessionId, 'completed');

    const view = h.writer.getSessionView(sessionId);

    assert.ok(view !== undefined);
    assert.equal(view.session.sessionId, sessionId);
    assert.deepEqual(view.declaredTargets, [target]);
    assert.equal(view.targets.length, 1);

    const changed = view.targets[0];

    assert.ok(changed !== undefined);
    assert.equal((changed.payload as { path: string }).path, target);
    assert.equal('payloadJson' in changed, false);
    assert.equal('inversePayloadJson' in changed, false);
    assert.ok(h.writer.listDeleteHistory().rows.length >= 0);

    const plan = await h.writer.planOperationReversal(sessionId, [changed.entryId]);

    assert.equal(plan.sessionId, sessionId);

    const reverted = await h.writer.revertOperations(sessionId, [changed.entryId]);

    assert.equal(reverted.sessionId, sessionId);
    assert.ok(Array.isArray(reverted.revertedEntries));

    const trashed = h.writer.trashSession(sessionId);

    assert.equal(trashed.session.isDeleted, true);
    assert.ok(h.writer.listDeleteHistory({ sessionId }).rows.some((row) => row.action === 'trash'));

    const restored = h.writer.restoreSession(sessionId);

    assert.equal(restored.session.isDeleted, false);

    const deleted = h.writer.deleteSessionPermanently(sessionId);

    assert.equal(deleted.sessionId, sessionId);

    const other = await h.writer.beginSession('wipe probe', []);

    await h.writer.commitSession(other, 'completed');

    await assert.rejects(
      () => h.writer.wipeAllSessions('not the phrase'),
      /confirmation/u,
    );

    const wiped = await h.writer.wipeAllSessions(WIPE_CONFIRMATION_PHRASE);

    assert.ok(wiped.deletedCount >= 1);

    const before = h.writer.listDeleteHistory().rows.length;

    assert.ok(before >= 1);
    assert.equal(h.writer.deleteAuditLog({}), before);
    assert.equal(h.writer.listDeleteHistory().rows.length, 0);
  });

  it('gates read and write authority separately', async (context) => {
    const h = await boot(context);
    const sessionId = await h.writer.beginSession('read gate probe', []);

    await h.writer.commitSession(sessionId, 'completed');

    // Read authority: listings and snapshots work.
    assert.ok((await h.reader.listSessions()).some((row) => row.session_id === sessionId));
    assert.equal(h.reader.getSessionView(sessionId)?.session.sessionId, sessionId);
    assert.ok(h.reader.listDeleteHistory().rows.length >= 0);
    assert.equal((await h.reader.planOperationReversal(sessionId, [])).sessionId, sessionId);

    // Write authority: every mutation rejects and never reaches the service.
    assert.throws(() => h.reader.trashSession(sessionId), isReadOnlyViolation);
    assert.throws(() => h.reader.restoreSession(sessionId), isReadOnlyViolation);
    assert.throws(() => h.reader.deleteSessionPermanently(sessionId), isReadOnlyViolation);
    assert.throws(() => h.reader.deleteAuditLog({}), isReadOnlyViolation);
    await assert.rejects(
      () => h.reader.wipeAllSessions(WIPE_CONFIRMATION_PHRASE),
      isReadOnlyViolation,
    );
    await assert.rejects(
      () => h.reader.revertOperations(sessionId, []),
      isReadOnlyViolation,
    );

    // The read-only rejections left the session intact for the writer.
    assert.equal(h.writer.getSessionView(sessionId)?.session.status, 'committed');
  });
});