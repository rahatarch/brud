import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { FileSystemToken } from '../../BrudFileSystem/descriptor/tokens.js';
import { createFileMutationJournal } from '../../BrudFileSystem/events/FileMutationJournal.js';
import type { FileMutationEvent } from '../../BrudFileSystem/events/types.js';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import {
  HISTORY_DB_RELATIVE_PATH,
  HISTORY_SERVICE_TIER,
  createHistoryDescriptor,
} from '../descriptor/HistoryDescriptor.js';
import { HistoryToken } from '../descriptor/tokens.js';
import { HistoryAccessDeniedError } from '../descriptor/ReadOnlyHistoryFacade.js';

function caller(
  workspaceRoot: string,
  callerId = 'test.history',
  tier: ServiceContext['tier'] = 'core',
): ServiceContext {
  return { callerId, tier, workspaceRoot };
}

function isProtected(error: unknown): boolean {
  return error instanceof WorkspaceViolationError
    && error.code === 'WORKSPACE_PATH_VIOLATION'
    && error.rule === 'PROTECTED_PATH_DENIED';
}

async function createTempWorkspace(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-history-boot-'));

  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

describe('createHistoryDescriptor', () => {
  it('declares the core tier and filesystem/workspace/settings dependencies', () => {
    const descriptor = createHistoryDescriptor();

    assert.equal(descriptor.token, HistoryToken);
    assert.equal(descriptor.token.id, 'brud.core.history');
    assert.equal(descriptor.tier, HISTORY_SERVICE_TIER);
    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      ['brud.core.filesystem', 'brud.core.workspace', 'brud.core.settings.reader'],
    );
  });
});

describe('UniversalHistory bootstrap and access gating', () => {
  it('records kernel mutations in history.db and blocks non-owners from .brud/history', async (context) => {
    const workspaceRoot = await createTempWorkspace(context);
    const events: FileMutationEvent[] = [];
    const journal = createFileMutationJournal();

    journal.subscribe((event) => {
      events.push(event);
    });

    // Legacy-engine test (pinned since D-15 U-6; removed with the legacy engine in U-7).
    const kernel = createStandardKernel({
      historyEngine: 'legacy',
      mutationJournal: journal,
      historyJournal: {},
    });

    await kernel.boot({ workspaceRoot });

    try {
      const history = kernel.requestAccess(caller(workspaceRoot), HistoryToken);
      const writer = kernel.requestAccess(
        caller(workspaceRoot, 'test.writer'),
        FileSystemToken,
      );

      await history.beginSession('session-gating', { suite: 'bootstrap' });
      await writer.writeAtomic('src/guarded.txt', 'payload\n');

      const entries = await history.getHistory({ targetPath: 'src/guarded.txt' });
      const entry = entries[0];

      assert.ok(entry !== undefined);
      assert.equal(entry.operationKind, 'write');
      assert.equal(entry.sessionId, 'session-gating');
      assert.equal(events.filter((event) => event.path === 'src/guarded.txt').length, 2);

      assert.equal(
        existsSync(join(workspaceRoot, HISTORY_DB_RELATIVE_PATH)),
        true,
      );

      const pluginLikeFileSystem = kernel.requestAccess(
        caller(workspaceRoot, 'acme.plugin'),
        FileSystemToken,
      );

      await assert.rejects(
        pluginLikeFileSystem.writeAtomic('.brud/history/history.db', 'corrupt'),
        isProtected,
      );
      await assert.rejects(
        pluginLikeFileSystem.createFile('.brud/history/blobs/evil', 'corrupt'),
        isProtected,
      );

      const userlandHistory = kernel.requestAccess(
        caller(workspaceRoot, 'acme.plugin', 'userland'),
        HistoryToken,
      );

      assert.equal((await userlandHistory.getHistory()).length > 0, true);
      await assert.rejects(userlandHistory.undo(), HistoryAccessDeniedError);

      const historyFileSystem = kernel.requestAccess(
        caller(workspaceRoot, 'brud.core.history'),
        FileSystemToken,
      );

      await historyFileSystem.writeAtomic('.brud/history/probe.txt', 'allowed');
    } finally {
      await kernel.shutdown();
    }

    assert.equal(existsSync(join(workspaceRoot, HISTORY_DB_RELATIVE_PATH)), true);
  });
});
