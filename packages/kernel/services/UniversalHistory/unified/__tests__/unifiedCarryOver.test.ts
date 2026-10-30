/**
 * Behaviour carried over from the legacy history test suites (D-15 U-7).
 *
 * Every legacy behaviour still offered by the unified engine but not already
 * covered by the parity oracle or another unified suite is pinned here before
 * the legacy tests are deleted. The source of each case is named in its title.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createStandardKernel } from '../../../../src/bootstrap/index.js';
import type { BrudKernel } from '../../../../src/engine/BrudKernel.js';
import type { KernelLogger, ServiceContext } from '../../../../src/contracts/lifecycle.js';
import { FileSystemToken } from '../../../BrudFileSystem/descriptor/tokens.js';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { createFileMutationJournal } from '../../../BrudFileSystem/events/FileMutationJournal.js';
import { HistoryToken, UniversalHistoryToken } from '../../descriptor/tokens.js';
import { createUnifiedHistoryDescriptors } from '../descriptor/unifiedHistoryDescriptors.js';
import {
  BINARY_PROBE_LENGTH,
  UnifiedInvalidTargetPathError,
  isBinaryContent,
  normalizeTargetPath,
} from '../service/index.js';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

async function workspace(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-unified-carry-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function boot(root: string, logger?: KernelLogger): Promise<BrudKernel> {
  const kernel = createStandardKernel();
  await kernel.boot({ workspaceRoot: root, ...(logger === undefined ? {} : { logger }) });
  return kernel;
}

const caller = (root: string): ServiceContext => ({ callerId: 'test.history', tier: 'core', workspaceRoot: root });

describe('unified history — carried-over legacy behaviour', () => {
  it('round-trips an empty file through a session revert (legacy baseline capture: empty files)', async (context) => {
    const root = await workspace(context);
    const kernel = await boot(root);
    try {
      const fs = kernel.requestAccess(caller(root), FileSystemToken);
      const history = kernel.requestAccess(caller(root), UniversalHistoryToken);
      await fs.writeAtomic('empty.txt', '');
      const session = await history.beginSession('fill an empty file', ['empty.txt']);
      await fs.writeAtomic('empty.txt', 'now has text\n');
      const receipt = await history.commitSession(session, 'completed');
      assert.equal(receipt.committedFileCount, 1);

      const plan = await history.planReversal(session);
      assert.equal(plan.isExecutable, true);
      await history.executeReversal(plan);
      assert.equal(await fs.readText('empty.txt'), '');
    } finally {
      await kernel.shutdown();
    }
  });

  it('classifies binary content only by a NUL byte inside the probe window (legacy baseline capture: binary rules)', () => {
    assert.equal(isBinaryContent(Uint8Array.from([0xc3, 0xa9, 0xff, 0xfe, 0x80])), false);
    assert.equal(isBinaryContent(Uint8Array.from([0x41, 0x00, 0x42])), true);
    const lateNul = new Uint8Array(BINARY_PROBE_LENGTH + 10).fill(0x41);
    lateNul[BINARY_PROBE_LENGTH + 5] = 0;
    assert.equal(isBinaryContent(lateNul), false);
    const edgeNul = new Uint8Array(BINARY_PROBE_LENGTH).fill(0x41);
    edgeNul[BINARY_PROBE_LENGTH - 1] = 0;
    assert.equal(isBinaryContent(edgeNul), true);
    assert.equal(isBinaryContent(text('')), false);
  });

  it('normalizes declared targets and rejects unsafe ones before any write (legacy baseline capture and session ledger: paths)', async (context) => {
    assert.equal(normalizeTargetPath('./src\\a.ts'), 'src/a.ts');
    assert.equal(normalizeTargetPath('src/dir/'), 'src/dir');
    for (const bad of ['', '/etc/passwd', 'C:/x', '../escape', 'a/../../b', 'a//b', 'nul\0byte']) {
      assert.throws(() => normalizeTargetPath(bad), UnifiedInvalidTargetPathError, JSON.stringify(bad));
    }

    const root = await workspace(context);
    const kernel = await boot(root);
    try {
      const history = kernel.requestAccess(caller(root), UniversalHistoryToken);
      const before = await history.listSessions({ limit: 100 });
      for (const bad of ['/etc/passwd', '../escape', '']) {
        await assert.rejects(() => history.beginSession('unsafe', [bad]), UnifiedInvalidTargetPathError);
      }
      assert.equal((await history.listSessions({ limit: 100 })).length, before.length);

      const session = await history.beginSession('normalized', ['./a.txt', 'a.txt', 'dir\\b.txt']);
      assert.deepEqual((await history.getSession(session))?.filesAffected, ['a.txt', 'dir/b.txt']);
    } finally {
      await kernel.shutdown();
    }
  });

  it('commits and reverts a session that stayed active across a restart (legacy session service: predating sessions)', async (context) => {
    const root = await workspace(context);
    const first = await boot(root);
    let session: string;
    try {
      const fs = first.requestAccess(caller(root), FileSystemToken);
      const history = first.requestAccess(caller(root), UniversalHistoryToken);
      await fs.writeAtomic('kept.txt', 'before\n');
      session = await history.beginSession('spans a restart', ['kept.txt']);
      await fs.writeAtomic('kept.txt', 'during first boot\n');
    } finally {
      await first.shutdown();
    }

    const second = await boot(root);
    try {
      const fs = second.requestAccess(caller(root), FileSystemToken);
      const history = second.requestAccess(caller(root), UniversalHistoryToken);
      assert.equal((await history.getSession(session))?.status, 'active');
      await fs.writeAtomic('kept.txt', 'after restart\n');
      const receipt = await history.commitSession(session, 'completed');
      assert.equal(receipt.committedFileCount, 1);

      const plan = await history.planReversal(session);
      assert.equal(plan.isExecutable, true);
      await history.executeReversal(plan);
      assert.equal(await fs.readText('kept.txt'), 'before\n');
    } finally {
      await second.shutdown();
    }
  });

  it('pages sessions with limit and offset, newest first (legacy session ledger: pagination)', async (context) => {
    const root = await workspace(context);
    const kernel = await boot(root);
    try {
      const history = kernel.requestAccess(caller(root), UniversalHistoryToken);
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(await history.beginSession(`session ${index}`, []));
      }
      const newestFirst = [...ids].reverse();
      const all = (await history.listSessions({ limit: 10 })).map((row) => row.session_id);
      assert.deepEqual(all, newestFirst);
      const page = (await history.listSessions({ limit: 2, offset: 2 })).map((row) => row.session_id);
      assert.deepEqual(page, newestFirst.slice(2, 4));
      const deleted = (await history.listSessions({ limit: 10, includeDeleted: true })).map((row) => row.session_id);
      assert.deepEqual(deleted, newestFirst);
    } finally {
      await kernel.shutdown();
    }
  });

  it('declares core-tier descriptors with their boot dependencies (descriptor and bootstrap tests)', () => {
    const descriptors = createUnifiedHistoryDescriptors({
      driver: new InMemoryStorageDriver(),
      journal: createFileMutationJournal(),
      inMemory: true,
    });
    assert.equal(descriptors.session.token, UniversalHistoryToken);
    assert.equal(descriptors.session.tier, 'core');
    assert.deepEqual(descriptors.session.dependencies.map((token) => token.id), [FileSystemToken.id]);
    assert.equal(descriptors.journal.token, HistoryToken);
    assert.equal(descriptors.journal.tier, 'core');
    assert.deepEqual(descriptors.journal.dependencies.map((token) => token.id), [UniversalHistoryToken.id]);
  });

  it('boots with a malformed legacy seq.json, reports it, and still allocates ids (legacy id allocator: malformed counter)', async (context) => {
    const root = await workspace(context);
    await mkdir(join(root, '.brud', 'history'), { recursive: true });
    await writeFile(join(root, '.brud', 'history', 'seq.json'), '{ not json');
    const warnings: { message: string; data?: Record<string, unknown> }[] = [];
    const logger = {
      debug: (): void => undefined,
      info: (): void => undefined,
      warn: (message: string, data?: Record<string, unknown>): void => {
        warnings.push({ message, ...(data === undefined ? {} : { data }) });
      },
      error: (): void => undefined,
    } as unknown as KernelLogger;

    const kernel = await boot(root, logger);
    try {
      const history = kernel.requestAccess(caller(root), UniversalHistoryToken);
      const session = await history.beginSession('after a bad counter', []);
      assert.match(session, /^BR-\d{8}-\d{3,}$/u);
      assert.ok(
        warnings.some((warning) => warning.data?.code === 'HISTORY_IMPORT_FAILED'),
        JSON.stringify(warnings),
      );
    } finally {
      await kernel.shutdown();
    }
  });
});
