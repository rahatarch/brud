/**
 * Goal 4 — Transaction integrity.
 *
 * Every probe uses the real unified history service. A session is observed
 * through the public IUniversalHistoryService contract, and pre-state bytes are
 * compared with the actual bytes on disk.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IBrudFileSystem } from '@brud/kernel';
import { appendFile } from '../groups/file/appendFile/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { deleteFile } from '../groups/file/deleteFile/index.js';
import { moveFile } from '../groups/file/moveFile/index.js';
import { renameFile } from '../groups/file/renameFile/index.js';
import { copyFile } from '../groups/file/copyFile/index.js';
import { createDirectory } from '../groups/directory/createDirectory/index.js';
import { deleteDirectory } from '../groups/directory/deleteDirectory/index.js';
import { moveDirectory } from '../groups/directory/moveDirectory/index.js';
import { appendFileMulti } from '../groups/multi/appendFileMulti/index.js';
import { searchReplace } from '../groups/multi/searchReplace/index.js';
import { searchReplaceMulti } from '../groups/multi/searchReplaceMulti/index.js';
import type { FilesystemRuntime } from '../runtime.js';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  createRuntime,
  errorCode,
  fakeSearch,
  invoke,
  mutationData,
  readReal,
  releaseVerificationLock,
  sha256,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

const SESSION_ID = /^BR-\d{8}-\d{3,4}$/u;
const SESSION_ID_HINT = /^BR-\d{8}-\d{3,4}$/u;

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-tx-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

function countSessions(status?: 'committed' | 'aborted'): Promise<number> {
  return kernel.history
    .listSessions(status === undefined ? { limit: 1000 } : { status, limit: 1000 })
    .then((rows) => rows.length);
}

function assertSession(result: Awaited<ReturnType<typeof invoke>>): string {
  const data = mutationData(result);

  assert.equal(result.status, 'success');
  assert.ok(data.sessionId, 'a successful mutation must return a session id');
  assert.match(data.sessionId, SESSION_ID);
  assert.equal(SESSION_ID_HINT.test(data.sessionId), true);

  return data.sessionId;
}

describe('Goal 4 — every tool opens and commits a session', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly run: () => Promise<Awaited<ReturnType<typeof invoke>>>;
  }> = [
    {
      name: 'create_file',
      run: () => invoke(kernel, 'create_file', { path: 'tx/create.txt', content: 'c' }),
    },
    {
      name: 'delete_file',
      run: async () => {
        await writeReal(kernel.root, 'tx/delete.txt', 'd');
        return invoke(kernel, 'delete_file', { path: 'tx/delete.txt' });
      },
    },
    {
      name: 'rename_file',
      run: async () => {
        await writeReal(kernel.root, 'tx/rename-from.txt', 'r');
        return invoke(kernel, 'rename_file', {
          from: 'tx/rename-from.txt',
          to: 'tx/rename-to.txt',
        });
      },
    },
    {
      name: 'move_file',
      run: async () => {
        await writeReal(kernel.root, 'tx/move-from.txt', 'm');
        return invoke(kernel, 'move_file', {
          from: 'tx/move-from.txt',
          to: 'tx/moved/to.txt',
        });
      },
    },
    {
      name: 'copy_file',
      run: async () => {
        await writeReal(kernel.root, 'tx/copy-from.txt', 'p');
        return invoke(kernel, 'copy_file', {
          from: 'tx/copy-from.txt',
          to: 'tx/copied/to.txt',
        });
      },
    },
    {
      name: 'append_file',
      run: async () => {
        await writeReal(kernel.root, 'tx/append.txt', 'a');
        return invoke(kernel, 'append_file', { path: 'tx/append.txt', content: 'b' });
      },
    },
    {
      name: 'create_directory',
      run: () => invoke(kernel, 'create_directory', {
        directoryPath: 'tx/dir',
        files: ['one.txt'],
      }),
    },
    {
      name: 'delete_directory',
      run: async () => {
        await writeReal(kernel.root, 'tx/del-dir/one.txt', '1');
        return invoke(kernel, 'delete_directory', { directoryPath: 'tx/del-dir' });
      },
    },
    {
      name: 'move_directory',
      run: async () => {
        await writeReal(kernel.root, 'tx/move-dir/one.txt', '1');
        return invoke(kernel, 'move_directory', {
          from: 'tx/move-dir',
          to: 'tx/moved-dir',
        });
      },
    },
    {
      name: 'append_file_multi',
      run: async () => {
        await writeReal(kernel.root, 'tx/multi/a.txt', 'A');
        await writeReal(kernel.root, 'tx/multi/b.txt', 'B');
        return invoke(kernel, 'append_file_multi', {
          pattern: '**/*.txt',
          scope: 'tx/multi',
          content: 'X',
        });
      },
    },
    {
      name: 'search_replace',
      run: async () => {
        await writeReal(kernel.root, 'tx/replace.txt', 'old');
        return invoke(kernel, 'search_replace', {
          path: 'tx/replace.txt',
          search: 'old',
          replace: 'new',
        });
      },
    },
    {
      name: 'search_replace_multi',
      run: async () => {
        await writeReal(kernel.root, 'tx/multi-replace/a.txt', 'old');
        await writeReal(kernel.root, 'tx/multi-replace/b.txt', 'old');
        return invoke(kernel, 'search_replace_multi', {
          pattern: '**/*.txt',
          scope: 'tx/multi-replace',
          search: 'old',
          replace: 'new',
        });
      },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} commits a completed session`, async () => {
      const result = await testCase.run();
      const sessionId = assertSession(result);
      const session = await kernel.history.getSession(sessionId);

      assert.ok(session, `${testCase.name} session must exist`);
      assert.equal(session.status, 'committed');
      assert.ok(session.filesAffected.length > 0);
    });
  }
});

describe('Goal 4 — pre-state capture', () => {
  it('records a created file as absent before the mutation', async () => {
    const result = await invoke(kernel, 'create_file', {
      path: 'tx/pre-create.txt',
      content: 'created',
    });
    const data = mutationData(result);
    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.deepEqual(session.preDigests['tx/pre-create.txt']?.exists, false);
    assert.equal(session.preDigests['tx/pre-create.txt']?.sha256, '');
    assert.equal(data.preState?.[0]?.status, 'missing');
    assert.equal(session.postDigests['tx/pre-create.txt']?.exists, true);
  });

  it('captures the file bytes before delete_file', async () => {
    await writeReal(kernel.root, 'tx/pre-delete.txt', 'delete-me-exactly');
    const result = await invoke(kernel, 'delete_file', { path: 'tx/pre-delete.txt' });
    const data = mutationData(result);
    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.equal(data.preState?.[0]?.content, 'delete-me-exactly');
    assert.equal(data.preState?.[0]?.size, 17);
    assert.equal(
      session.preDigests['tx/pre-delete.txt']?.sha256,
      sha256('delete-me-exactly'),
    );
    assert.equal(session.postDigests['tx/pre-delete.txt']?.exists, false);
  });

  it('delete_file on a missing target is a committed skip without corruption', async () => {
    const before = await countSessions();
    const result = await invoke(kernel, 'delete_file', { path: 'tx/missing.txt' });
    const data = mutationData(result);

    assert.equal(result.status, 'success');
    assert.equal(data.skipped[0]?.code, 'FILE_NOT_FOUND');
    assert.ok(data.sessionId);

    const session = await kernel.history.getSession(data.sessionId);

    assert.ok(session);
    assert.equal(session.status, 'committed');
    assert.equal(session.preDigests['tx/missing.txt']?.exists, false);
    assert.ok((await countSessions()) >= before);
  });

  it('rename_file captures the pre-state of source and destination', async () => {
    await writeReal(kernel.root, 'tx/pre-rename.txt', 'rename-bytes');
    const result = await invoke(kernel, 'rename_file', {
      from: 'tx/pre-rename.txt',
      to: 'tx/post-rename.txt',
    });
    const data = mutationData(result);
    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.deepEqual(
      [...session.filesAffected].sort(),
      ['tx/post-rename.txt', 'tx/pre-rename.txt'],
    );
    assert.equal(session.preDigests['tx/pre-rename.txt']?.exists, true);
    assert.equal(session.preDigests['tx/post-rename.txt']?.exists, false);
    assert.equal(data.preState?.length, 2);
  });

  it('append_file captures the original content', async () => {
    await writeReal(kernel.root, 'tx/pre-append.txt', 'original');
    const result = await invoke(kernel, 'append_file', {
      path: 'tx/pre-append.txt',
      content: 'added',
    });
    const data = mutationData(result);
    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.equal(data.preState?.[0]?.content, 'original');
    assert.equal(
      session.preDigests['tx/pre-append.txt']?.sha256,
      sha256('original'),
    );
    assert.equal(await readReal(kernel.root, 'tx/pre-append.txt'), 'original\n\nadded');
  });

  it('search_replace captures the original content', async () => {
    await writeReal(kernel.root, 'tx/pre-replace.txt', 'alpha beta');
    const result = await invoke(kernel, 'search_replace', {
      path: 'tx/pre-replace.txt',
      search: 'beta',
      replace: 'BETA',
    });
    const data = mutationData(result);
    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.equal(data.preState?.[0]?.content, 'alpha beta');
    assert.equal(
      session.preDigests['tx/pre-replace.txt']?.sha256,
      sha256('alpha beta'),
    );
  });

  it('delete_directory declares every contained file in the session', async () => {
    await writeReal(kernel.root, 'tx/pre-del-dir/a.txt', 'a');
    await writeReal(kernel.root, 'tx/pre-del-dir/nested/b.txt', 'b');
    const result = await invoke(kernel, 'delete_directory', {
      directoryPath: 'tx/pre-del-dir',
    });
    const data = mutationData(result);
    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.deepEqual(
      [...session.filesAffected].sort(),
      ['tx/pre-del-dir/a.txt', 'tx/pre-del-dir/nested/b.txt'],
    );
    assert.equal(data.preState?.filter((entry) => entry.status === 'file').length, 2);
  });
});

describe('Goal 4 — failed mutations abort cleanly', () => {
  it('search_replace with zero matches aborts the session and writes nothing', async () => {
    await writeReal(kernel.root, 'tx/no-match.txt', 'nothing matches here');
    const result = await invoke(kernel, 'search_replace', {
      path: 'tx/no-match.txt',
      search: 'absent-token',
      replace: 'x',
    });
    const data = mutationData(result);

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'SEARCH_NOT_FOUND');
    assert.equal(await readReal(kernel.root, 'tx/no-match.txt'), 'nothing matches here');

    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.equal(session.status, 'aborted');
    assert.equal(
      session.postDigests['tx/no-match.txt']?.sha256,
      session.preDigests['tx/no-match.txt']?.sha256,
      'an aborted session must not record a forward delta',
    );
    await assert.rejects(
      () => kernel.history.planReversal(data.sessionId!),
      'an aborted session must not be revertible',
    );
  });

  it('search_replace with multiple matches aborts and leaves bytes intact', async () => {
    await writeReal(kernel.root, 'tx/multi-match.txt', 'same same');
    const result = await invoke(kernel, 'search_replace', {
      path: 'tx/multi-match.txt',
      search: 'same',
      replace: 'different',
    });

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'MULTIPLE_MATCHES');
    assert.equal(await readReal(kernel.root, 'tx/multi-match.txt'), 'same same');
  });

  it('commits aborted when writeAtomic throws midway', async () => {
    await writeReal(kernel.root, 'tx/midway.txt', 'original-bytes');
    const failing: IBrudFileSystem = new Proxy(kernel.fs, {
      get(target, property, receiver) {
        if (property === 'writeAtomic') {
          return async (path: string): Promise<void> => {
            if (path === 'tx/midway.txt') {
              throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
            }

            return target.writeAtomic(path, '');
          };
        }

        const value = Reflect.get(target, property, receiver) as unknown;

        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const runtime: FilesystemRuntime = {
      ...createRuntime(kernel),
      getFileSystem: () => failing,
    };

    const result = await appendFile(
      { path: 'tx/midway.txt', content: 'never-written' },
      runtime,
    );
    const data = mutationData(result);

    assert.equal(result.status, 'failed');
    assert.equal(errorCode(result), 'EXECUTION_FAILED');
    assert.equal(await readReal(kernel.root, 'tx/midway.txt'), 'original-bytes');

    const session = await kernel.history.getSession(data.sessionId!);

    assert.ok(session);
    assert.equal(session.status, 'aborted');
  });

  it('surfaces a history commit failure as HISTORY_FAILED', async () => {
    const runtime: FilesystemRuntime = {
      ...createRuntime(kernel),
      getUniversalHistory: () => ({
        beginSession: (prompt: string, targets?: readonly string[]) =>
          kernel.history.beginSession(prompt, targets),
        commitSession: async (): Promise<never> => {
          throw new Error('simulated ledger failure');
        },
        planReversal: kernel.history.planReversal.bind(kernel.history),
        executeReversal: kernel.history.executeReversal.bind(kernel.history),
        getSession: kernel.history.getSession.bind(kernel.history),
        listSessions: kernel.history.listSessions.bind(kernel.history),
      }),
    };

    const result = await createFile(
      { path: 'tx/commit-failure.txt', content: 'mutated-before-commit-failure' },
      runtime,
    );

    assert.equal(result.status, 'failed');
    assert.equal(errorCode(result), 'HISTORY_FAILED');
    assert.equal(
      await readReal(kernel.root, 'tx/commit-failure.txt'),
      'mutated-before-commit-failure',
    );
  });

  it('rejects a malformed session identifier before applying a mutation', async () => {
    const runtime: FilesystemRuntime = {
      ...createRuntime(kernel),
      getUniversalHistory: () => ({
        beginSession: async (): Promise<string> => 'forged-session',
        commitSession: async (): Promise<never> => {
          throw new Error('must not be called');
        },
        planReversal: kernel.history.planReversal.bind(kernel.history),
        executeReversal: kernel.history.executeReversal.bind(kernel.history),
        getSession: kernel.history.getSession.bind(kernel.history),
        listSessions: kernel.history.listSessions.bind(kernel.history),
      }),
    };

    const result = await createFile(
      { path: 'tx/forged-session.txt', content: 'must-not-exist' },
      runtime,
    );

    assert.equal(result.status, 'failed');
    assert.equal(errorCode(result), 'HISTORY_FAILED');
    assert.equal(await readReal(kernel.root, 'tx/forged-session.txt').catch(() => ''), '');
  });
});