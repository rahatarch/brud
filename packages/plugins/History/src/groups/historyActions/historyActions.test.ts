import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HISTORY_PLUGIN_ID,
  bootHistoryHarness,
  resultError,
  type HistoryHarness,
} from '../../__tests__/support/harness.js';
import {
  HISTORY_DELETE_AUDIT_LOG_ACTION,
  HISTORY_GET_SNAPSHOTS_ACTION,
  HISTORY_LIST_SESSIONS_ACTION,
  HISTORY_PERMANENT_DELETE_ACTION,
  HISTORY_RESTORE_SESSION_ACTION,
  HISTORY_REVERT_AUDIT_LOG_ACTION,
  HISTORY_REVERT_OPERATIONS_ACTION,
  HISTORY_REVERT_SESSION_ACTION,
  HISTORY_TRASH_SESSION_ACTION,
  HISTORY_WIPE_ALL_ACTION,
  historyWipeAll,
} from './historyActions.js';
import { WIPE_CONFIRMATION_PHRASE } from '../shared/index.js';

interface ListSessionsData {
  readonly sessions: readonly { readonly session_id: string }[];
  readonly count: number;
}

interface TrashData {
  readonly session: { readonly isDeleted: boolean };
}

interface AuditData {
  readonly rows: readonly {
    readonly action: string;
    readonly sessionId: string | null;
  }[];
}

describe('history actions', () => {
  let harness: HistoryHarness;

  beforeEach(async () => {
    harness = await bootHistoryHarness();
  });

  afterEach(async () => {
    await harness?.shutdown();
  });

  it('registers exactly the ten UI actions and no tools', () => {
    const owned = harness.actions
      .listActions()
      .filter((action) => action.ownerPluginId === HISTORY_PLUGIN_ID);
    const expected = [
      HISTORY_REVERT_SESSION_ACTION,
      HISTORY_REVERT_OPERATIONS_ACTION,
      HISTORY_LIST_SESSIONS_ACTION,
      HISTORY_GET_SNAPSHOTS_ACTION,
      HISTORY_TRASH_SESSION_ACTION,
      HISTORY_RESTORE_SESSION_ACTION,
      HISTORY_PERMANENT_DELETE_ACTION,
      HISTORY_WIPE_ALL_ACTION,
      HISTORY_REVERT_AUDIT_LOG_ACTION,
      HISTORY_DELETE_AUDIT_LOG_ACTION,
    ];

    assert.deepEqual(owned.map((action) => action.name).sort(), expected.sort());

    const toolNames = harness.tools.listTools().map((tool) => tool.name);

    for (const actionName of expected) {
      assert.equal(toolNames.includes(actionName), false);
    }
  });

  it('declares additionalProperties:false on every action schema', () => {
    const owned = harness.actions
      .listActions()
      .filter((action) => action.ownerPluginId === HISTORY_PLUGIN_ID);

    assert.equal(owned.length, 10);

    for (const action of owned) {
      assert.equal(
        (action.parametersSchema as Record<string, unknown>).additionalProperties,
        false,
        `${action.name} must reject unknown properties`,
      );
    }
  });

  it('rejects unknown properties and a wrong wipe phrase at the schema gate', async () => {
    const unknown = await harness.actions.executeAction(
      HISTORY_LIST_SESSIONS_ACTION,
      { unexpected: true },
      harness.actionContext,
    );

    assert.equal(unknown.status, 'failed');
    assert.match(resultError(unknown), /ACTION_VALIDATION_ERROR/u);

    const wrongPhrase = await harness.actions.executeAction(
      HISTORY_WIPE_ALL_ACTION,
      { confirmation: 'delete all history' },
      harness.actionContext,
    );

    assert.equal(wrongPhrase.status, 'failed');
    assert.match(resultError(wrongPhrase), /ACTION_VALIDATION_ERROR/u);
  });

  it('still enforces the wipe phrase in the kernel when the schema is bypassed', async () => {
    const result = await historyWipeAll(
      { confirmation: 'delete all history' },
      harness.history,
      harness.actionContext,
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'WIPE_CONFIRMATION_REQUIRED');
  });

  it('history.revert_session restores the pre-state end to end', async () => {
    const seeded = await harness.seed('action-revert-session.txt', 'before');
    const result = await harness.actions.executeAction(
      HISTORY_REVERT_SESSION_ACTION,
      { sessionId: seeded.sessionId, targetState: 'pre' },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as { sessionId: string }).sessionId, seeded.sessionId);
    await assert.rejects(() => access(join(harness.root, seeded.target)));
  });

  it('history.revert_operations restores one selected operation end to end', async () => {
    const seeded = await harness.seed('action-revert-operations.txt', 'before');
    const result = await harness.actions.executeAction(
      HISTORY_REVERT_OPERATIONS_ACTION,
      { sessionId: seeded.sessionId, operationIds: [seeded.entryId] },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as { sessionId: string }).sessionId, seeded.sessionId);
    await assert.rejects(() => access(join(harness.root, seeded.target)));
  });

  it('history.list_sessions returns a seeded session end to end', async () => {
    const seeded = await harness.seed('action-list.txt', 'listed');
    const result = await harness.actions.executeAction(
      HISTORY_LIST_SESSIONS_ACTION,
      {},
      harness.actionContext,
    );

    assert.equal(result.status, 'success');

    const data = result.data as ListSessionsData;

    assert.equal(data.count, data.sessions.length);
    assert.ok(data.sessions.some((session) => session.session_id === seeded.sessionId));
  });

  it('history.get_snapshots returns the sanitized session view end to end', async () => {
    const seeded = await harness.seed('action-snapshots.txt', 'snapshot');
    const result = await harness.actions.executeAction(
      HISTORY_GET_SNAPSHOTS_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');

    const data = result.data as {
      session: { sessionId: string };
      declaredTargets: readonly string[];
      degraded: boolean;
    };

    assert.equal(data.session.sessionId, seeded.sessionId);
    assert.deepEqual(data.declaredTargets, [seeded.target]);
    assert.equal(data.degraded, true);
  });

  it('history.trash_session moves a session to the trash end to end', async () => {
    const seeded = await harness.seed('action-trash.txt', 'trash');
    const result = await harness.actions.executeAction(
      HISTORY_TRASH_SESSION_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as TrashData).session.isDeleted, true);
  });

  it('history.restore_session returns a trashed session end to end', async () => {
    const seeded = await harness.seed('action-restore.txt', 'restore');

    await harness.actions.executeAction(
      HISTORY_TRASH_SESSION_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    const result = await harness.actions.executeAction(
      HISTORY_RESTORE_SESSION_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as TrashData).session.isDeleted, false);
  });

  it('history.permanent_delete removes the session end to end', async () => {
    const seeded = await harness.seed('action-delete.txt', 'delete');
    const result = await harness.actions.executeAction(
      HISTORY_PERMANENT_DELETE_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as { sessionId: string }).sessionId, seeded.sessionId);
    assert.equal(harness.history.getSessionView(seeded.sessionId), undefined);
  });

  it('history.wipe_all deletes every session with the exact phrase end to end', async () => {
    await harness.seed('action-wipe.txt', 'wipe');
    const result = await harness.actions.executeAction(
      HISTORY_WIPE_ALL_ACTION,
      { confirmation: WIPE_CONFIRMATION_PHRASE },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');
    assert.ok((result.data as { deletedCount: number }).deletedCount >= 1);
  });

  it('history.revert_audit_log lists lifecycle events end to end', async () => {
    const seeded = await harness.seed('action-audit.txt', 'audit');

    await harness.actions.executeAction(
      HISTORY_TRASH_SESSION_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    const result = await harness.actions.executeAction(
      HISTORY_REVERT_AUDIT_LOG_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    assert.equal(result.status, 'success');

    const data = result.data as AuditData;

    assert.ok(data.rows.some(
      (row) => row.sessionId === seeded.sessionId && row.action === 'trash',
    ));
  });

  it('history.delete_audit_log removes matching lifecycle events end to end', async () => {
    const seeded = await harness.seed('action-delete-audit.txt', 'audit');

    await harness.actions.executeAction(
      HISTORY_TRASH_SESSION_ACTION,
      { sessionId: seeded.sessionId },
      harness.actionContext,
    );

    const deleted = await harness.actions.executeAction(
      HISTORY_DELETE_AUDIT_LOG_ACTION,
      {},
      harness.actionContext,
    );

    assert.equal(deleted.status, 'success');
    assert.ok((deleted.data as { deleted: number }).deleted >= 1);

    const listed = await harness.actions.executeAction(
      HISTORY_REVERT_AUDIT_LOG_ACTION,
      {},
      harness.actionContext,
    );

    assert.equal(listed.status, 'success');
    assert.equal((listed.data as AuditData).rows.length, 0);
  });
});