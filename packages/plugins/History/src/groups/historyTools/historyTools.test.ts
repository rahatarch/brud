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
  LIST_SESSIONS_TOOL,
  REVERT_OPERATIONS_TOOL,
  REVERT_SESSION_TOOL,
} from './historyTools.js';

interface ListSessionsData {
  readonly sessions: readonly { readonly session_id: string }[];
  readonly count: number;
}

describe('history tools', () => {
  let harness: HistoryHarness;

  beforeEach(async () => {
    harness = await bootHistoryHarness();
  });

  afterEach(async () => {
    await harness?.shutdown();
  });

  it('registers exactly the three AI tools and no actions', () => {
    const owned = harness.tools
      .listTools()
      .filter((tool) => tool.ownerPluginId === HISTORY_PLUGIN_ID);

    assert.deepEqual(
      owned.map((tool) => tool.name).sort(),
      [LIST_SESSIONS_TOOL, REVERT_OPERATIONS_TOOL, REVERT_SESSION_TOOL].sort(),
    );

    const actionNames = harness.actions.listActions().map((action) => action.name);

    for (const toolName of [LIST_SESSIONS_TOOL, REVERT_OPERATIONS_TOOL, REVERT_SESSION_TOOL]) {
      assert.equal(actionNames.includes(toolName), false);
    }
  });

  it('declares additionalProperties:false on every tool schema', () => {
    const owned = harness.tools
      .listTools()
      .filter((tool) => tool.ownerPluginId === HISTORY_PLUGIN_ID);

    assert.equal(owned.length, 3);

    for (const tool of owned) {
      assert.equal(
        (tool.parametersSchema as Record<string, unknown>).additionalProperties,
        false,
        `${tool.name} must reject unknown properties`,
      );
    }
  });

  it('rejects unknown properties and malformed session ids through the schema gate', async () => {
    const unknown = await harness.tools.executeTool(
      LIST_SESSIONS_TOOL,
      { unexpected: true },
      harness.toolContext,
    );

    assert.equal(unknown.status, 'failed');
    assert.match(resultError(unknown), /TOOL_VALIDATION_ERROR/u);

    const malformed = await harness.tools.executeTool(
      REVERT_SESSION_TOOL,
      { sessionId: 'not-a-session' },
      harness.toolContext,
    );

    assert.equal(malformed.status, 'failed');
    assert.match(resultError(malformed), /TOOL_VALIDATION_ERROR/u);
  });

  it('list_sessions returns a seeded session end to end', async () => {
    const seeded = await harness.seed('tool-list.txt', 'listed');
    const result = await harness.tools.executeTool(
      LIST_SESSIONS_TOOL,
      {},
      harness.toolContext,
    );

    assert.equal(result.status, 'success');

    const data = result.data as ListSessionsData;

    assert.equal(data.count, data.sessions.length);
    assert.ok(data.sessions.some((session) => session.session_id === seeded.sessionId));
  });

  it('revert_session restores the pre-state end to end', async () => {
    const seeded = await harness.seed('tool-revert-session.txt', 'before');
    const result = await harness.tools.executeTool(
      REVERT_SESSION_TOOL,
      { sessionId: seeded.sessionId, targetState: 'pre' },
      harness.toolContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as { sessionId: string }).sessionId, seeded.sessionId);
    await assert.rejects(() => access(join(harness.root, seeded.target)));
  });

  it('revert_operations restores one selected operation end to end', async () => {
    const seeded = await harness.seed('tool-revert-operations.txt', 'before');
    const result = await harness.tools.executeTool(
      REVERT_OPERATIONS_TOOL,
      { sessionId: seeded.sessionId, operationIds: [seeded.entryId] },
      harness.toolContext,
    );

    assert.equal(result.status, 'success');
    assert.equal((result.data as { sessionId: string }).sessionId, seeded.sessionId);
    await assert.rejects(() => access(join(harness.root, seeded.target)));
  });
});