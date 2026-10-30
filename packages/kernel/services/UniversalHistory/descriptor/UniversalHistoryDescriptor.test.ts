import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import {
  HISTORY_LEDGER_RELATIVE_PATH,
  HISTORY_SEQUENCE_RELATIVE_PATH,
  createUniversalHistoryDescriptor,
} from './UniversalHistoryDescriptor.js';
import { UniversalHistoryToken } from './tokens.js';

function caller(workspaceRoot: string): ServiceContext {
  return {
    callerId: 'test.history',
    tier: 'core',
    workspaceRoot,
  };
}

describe('createUniversalHistoryDescriptor', () => {
  it('describes a core service that depends on the filesystem', () => {
    const descriptor = createUniversalHistoryDescriptor();

    assert.equal(descriptor.token, UniversalHistoryToken);
    assert.equal(descriptor.tier, 'core');
    assert.deepEqual(
      descriptor.dependencies.map((token) => token.id),
      ['brud.core.filesystem'],
    );
  });

  it('boots through the standard kernel and persists the ledger on disk', async (context) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'brud-history-ledger-'));
    context.after(async () => {
      await rm(workspaceRoot, { recursive: true, force: true });
    });

    // Legacy-engine test (pinned since D-15 U-6; removed with the legacy engine in U-7).
    const kernel = createStandardKernel({ historyEngine: 'legacy' });
    await kernel.boot({ workspaceRoot });

    try {
      const history = kernel.requestAccess(caller(workspaceRoot), UniversalHistoryToken);
      const sessionId = await history.beginSession('descriptor smoke test');

      assert.match(sessionId, /^BR-\d{8}-\d{3}$/u);
      assert.equal(
        existsSync(join(workspaceRoot, HISTORY_LEDGER_RELATIVE_PATH)),
        true,
      );
      assert.equal(
        existsSync(join(workspaceRoot, HISTORY_SEQUENCE_RELATIVE_PATH)),
        true,
      );

      const manifest = await history.getSession(sessionId);
      assert.ok(manifest !== null);
      assert.equal(manifest.status, 'active');
    } finally {
      await kernel.shutdown();
    }
  });
});
