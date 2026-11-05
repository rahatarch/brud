/**
 * Goal 5 — Reversibility.
 *
 * Every mutation is committed through the real unified history service, then
 * reversed with planReversal/executeReversal. Success is measured by comparing
 * a canonical workspace snapshot (paths, kinds, and SHA-256) before and after.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IUniversalHistoryService } from '@brud/kernel';
import { appendFile } from '../groups/file/appendFile/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { deleteFile } from '../groups/file/deleteFile/index.js';
import { moveFile } from '../groups/file/moveFile/index.js';
import { renameFile } from '../groups/file/renameFile/index.js';
import { copyFile } from '../groups/file/copyFile/index.js';
import { createDirectory } from '../groups/directory/createDirectory/index.js';
import { deleteDirectory } from '../groups/directory/deleteDirectory/index.js';
import { moveDirectory } from '../groups/directory/moveDirectory/index.js';
import { searchReplace } from '../groups/multi/searchReplace/index.js';
import type { FilesystemRuntime } from '../runtime.js';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  canonicalSnapshot,
  casExists,
  casPath,
  createRuntime,
  invoke,
  mutationData,
  readReal,
  releaseVerificationLock,
  sha256,
  snapshotWorkspace,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-reverse-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

async function beforeSnapshot(seed: string): Promise<string> {
  await writeReal(kernel.root, seed, 'seed');

  return canonicalSnapshot(await snapshotWorkspace(kernel.root));
}

async function reverse(sessionId: string): Promise<void> {
  const plan = await kernel.history.planReversal(sessionId);

  assert.deepEqual(plan.conflicts, [], 'reversal plan must have no conflicts');
  assert.equal(plan.isExecutable, true);

  const receipt = await kernel.history.executeReversal(plan);

  assert.equal(receipt.sessionId, sessionId);
}

async function assertWorkspaceRestored(before: string): Promise<void> {
  const after = canonicalSnapshot(await snapshotWorkspace(kernel.root));

  assert.equal(after, before, 'the workspace must match its pre-mutation state');
}

describe('Goal 5 — file mutations reverse exactly', () => {
  it('create_file then reverse deletes the file', async () => {
    const before = await beforeSnapshot('rev/create/seed.txt');
    const result = await invoke(kernel, 'create_file', {
      path: 'rev/create/created.txt',
      content: 'created',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/create/created.txt').catch(() => ''), '');
    await assertWorkspaceRestored(before);
  });

  it('delete_file then reverse restores the exact bytes', async () => {
    await writeReal(kernel.root, 'rev/delete/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/delete/target.txt', 'restore-me-exactly');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'delete_file', { path: 'rev/delete/target.txt' });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/delete/target.txt'), 'restore-me-exactly');
    await assertWorkspaceRestored(before);
  });

  it('rename_file then reverse renames the file back', async () => {
    await writeReal(kernel.root, 'rev/rename/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/rename/old.txt', 'rename-back');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'rename_file', {
      from: 'rev/rename/old.txt',
      to: 'rev/rename/new.txt',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/rename/old.txt'), 'rename-back');
    assert.equal(await readReal(kernel.root, 'rev/rename/new.txt').catch(() => ''), '');
    await assertWorkspaceRestored(before);
  });

  it('move_file then reverse restores the source and removes the destination', async () => {
    await writeReal(kernel.root, 'rev/move/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/move/from.txt', 'move-back');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'move_file', {
      from: 'rev/move/from.txt',
      to: 'rev/move/to.txt',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/move/from.txt'), 'move-back');
    assert.equal(await readReal(kernel.root, 'rev/move/to.txt').catch(() => ''), '');
    await assertWorkspaceRestored(before);
  });

  it('copy_file then reverse removes the copy and keeps the source', async () => {
    await writeReal(kernel.root, 'rev/copy/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/copy/from.txt', 'copy-back');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'copy_file', {
      from: 'rev/copy/from.txt',
      to: 'rev/copy/to.txt',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/copy/from.txt'), 'copy-back');
    assert.equal(await readReal(kernel.root, 'rev/copy/to.txt').catch(() => ''), '');
    await assertWorkspaceRestored(before);
  });

  it('append_file then reverse removes the appended content', async () => {
    await writeReal(kernel.root, 'rev/append/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/append/target.txt', 'original');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'append_file', {
      path: 'rev/append/target.txt',
      content: 'appended',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/append/target.txt'), 'original');
    await assertWorkspaceRestored(before);
  });

  it('search_replace then reverse restores the original content', async () => {
    await writeReal(kernel.root, 'rev/replace/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/replace/target.txt', 'alpha beta gamma');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'search_replace', {
      path: 'rev/replace/target.txt',
      search: 'beta',
      replace: 'BETA',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/replace/target.txt'), 'alpha beta gamma');
    await assertWorkspaceRestored(before);
  });

  it('delete_directory then reverse restores every file', async () => {
    await writeReal(kernel.root, 'rev/delete-dir/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/delete-dir/a.txt', 'a');
    await writeReal(kernel.root, 'rev/delete-dir/nested/b.txt', 'b');
    await writeReal(kernel.root, 'rev/delete-dir/nested/deeper/c.txt', 'c');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'delete_directory', {
      directoryPath: 'rev/delete-dir',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    assert.equal(await readReal(kernel.root, 'rev/delete-dir/a.txt'), 'a');
    assert.equal(await readReal(kernel.root, 'rev/delete-dir/nested/b.txt'), 'b');
    assert.equal(await readReal(kernel.root, 'rev/delete-dir/nested/deeper/c.txt'), 'c');
    await assertWorkspaceRestored(before);
  });

  it('create_directory then reverse restores the pre-mutation workspace', async () => {
    const before = await beforeSnapshot('rev/create-dir/seed.txt');
    const result = await invoke(kernel, 'create_directory', {
      directoryPath: 'rev/create-dir/new',
      files: ['one.txt', 'nested/two.txt'],
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    await assertWorkspaceRestored(before);
  });

  it('move_directory then reverse restores the pre-mutation workspace', async () => {
    await writeReal(kernel.root, 'rev/move-dir/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/move-dir/a.txt', 'a');
    await writeReal(kernel.root, 'rev/move-dir/nested/b.txt', 'b');
    const before = canonicalSnapshot(await snapshotWorkspace(kernel.root));
    const result = await invoke(kernel, 'move_directory', {
      from: 'rev/move-dir',
      to: 'rev/move-dir-new',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    await assertWorkspaceRestored(before);
  });
});

describe('Goal 5 — pre-state provenance', () => {
  it('stores a large pre-state in the CAS store before commit', async () => {
    const content = 'L'.repeat(128 * 1024);
    await writeReal(kernel.root, 'rev/cas/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/cas/target.txt', content);
    const digest = sha256(content);
    const observations: Array<{
      sessionId: string;
      digest: string;
      casExistedBeforeCommit: boolean;
    }> = [];

    const wrapped: IUniversalHistoryService = {
      beginSession: async (prompt, targets) => {
        const sessionId = await kernel.history.beginSession(prompt, targets);
        observations.push({
          sessionId,
          digest,
          casExistedBeforeCommit: await casExists(kernel.root, digest),
        });

        return sessionId;
      },
      commitSession: (sessionId, outcome) =>
        kernel.history.commitSession(sessionId, outcome),
      planReversal: (sessionId, options) =>
        kernel.history.planReversal(sessionId, options),
      executeReversal: (plan) => kernel.history.executeReversal(plan),
      getSession: (sessionId) => kernel.history.getSession(sessionId),
      listSessions: (filter) => kernel.history.listSessions(filter),
    };
    const runtime: FilesystemRuntime = {
      ...createRuntime(kernel),
      getUniversalHistory: () => wrapped,
    };

    const result = await appendFile(
      { path: 'rev/cas/target.txt', content: 'appended' },
      runtime,
    );

    assert.equal(result.status, 'success');
    assert.equal(observations.length, 1);
    assert.equal(observations[0]?.digest, digest);
    assert.equal(
      observations[0]?.casExistedBeforeCommit,
      true,
      'the pre-state blob must exist in CAS when beginSession returns',
    );
    assert.equal(await casExists(kernel.root, digest), true);
    assert.equal(
      await readReal(kernel.root, '.brud/history/cas/' + digest.slice(0, 2) + '/' + digest).catch(() => ''),
      content,
    );
  });

  it('restores a small pre-state from the ledger even though it is inlined', async () => {
    await writeReal(kernel.root, 'rev/inline/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/inline/target.txt', 'small-original');
    const digest = sha256('small-original');

    const result = await invoke(kernel, 'append_file', {
      path: 'rev/inline/target.txt',
      content: 'more',
    });
    const sessionId = mutationData(result).sessionId!;
    const session = await kernel.history.getSession(sessionId);

    assert.ok(session);
    assert.equal(session.preDigests['rev/inline/target.txt']?.sha256, digest);
    assert.equal(
      await casExists(kernel.root, digest),
      false,
      'small pre-state is intentionally inlined rather than stored as a CAS blob',
    );

    await reverse(sessionId);
    assert.equal(await readReal(kernel.root, 'rev/inline/target.txt'), 'small-original');
  });

  it('marks the session reverted after a successful reversal', async () => {
    await writeReal(kernel.root, 'rev/status/seed.txt', 'seed');
    const result = await invoke(kernel, 'create_file', {
      path: 'rev/status/new.txt',
      content: 'x',
    });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);

    const session = await kernel.history.getSession(sessionId);

    assert.ok(session);
    assert.equal(session.status, 'reverted');
  });

  it('refuses to reverse an already-reverted session', async () => {
    await writeReal(kernel.root, 'rev/twice/seed.txt', 'seed');
    await writeReal(kernel.root, 'rev/twice/target.txt', 'once');
    const result = await invoke(kernel, 'delete_file', { path: 'rev/twice/target.txt' });
    const sessionId = mutationData(result).sessionId!;

    await reverse(sessionId);
    await assert.rejects(() => kernel.history.planReversal(sessionId));
  });

  it('keeps the CAS path derived strictly from the digest', () => {
    const digest = sha256('cas-path');

    assert.equal(
      casPath(kernel.root, digest),
      `${kernel.root}/.brud/history/cas/${digest.slice(0, 2)}/${digest}`,
    );
  });
});