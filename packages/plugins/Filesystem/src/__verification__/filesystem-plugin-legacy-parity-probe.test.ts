/**
 * Goal 9 — Legacy parity.
 *
 * The frozen legacy engine (packages/core/src/file-operations/index.ts) is
 * executed for real against a separate temp workspace with the real
 * NodeFileSystem. The plugin is executed against its own real kernel workspace.
 * Final trees, messages, statuses, and codes are normalized and compared.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { executeFileOperations } from '../../../../core/src/file-operations/index.js';
import type { FileOperation } from '../../../../core/src/types/legacy.js';
import { NodeFileSystem } from '../../../../core/src/testing/nodeFileSystem.js';
import { TestHistoryStore } from '../../../../core/src/testing/testHistoryStore.js';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  canonicalSnapshot,
  errorCode,
  invoke,
  makeTempDirectory,
  mutationData,
  readReal,
  releaseVerificationLock,
  removeReal,
  snapshotWorkspace,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

let kernel: VerificationKernel;
let legacyRoot: string;
let legacyFs: NodeFileSystem;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-parity-' });
  legacyRoot = await makeTempDirectory('brud-fs-parity-legacy-');
  legacyFs = new NodeFileSystem();
});

after(async () => {
  await kernel.shutdown();
  await removeReal(legacyRoot);
  await releaseVerificationLock();
});

interface ParityCase {
  readonly name: string;
  readonly seed: (root: string) => Promise<void>;
  readonly legacy: readonly FileOperation[];
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

async function seedTree(root: string): Promise<void> {
  await writeReal(root, 'seed/a.txt', 'a');
  await writeReal(root, 'seed/nested/b.txt', 'b');
}

async function seedRename(root: string): Promise<void> {
  await writeReal(root, 'rename/from.txt', 'rename-me');
}

async function seedMove(root: string): Promise<void> {
  await writeReal(root, 'move/from.txt', 'move-me');
}

async function seedCopy(root: string): Promise<void> {
  await writeReal(root, 'copy/from.txt', 'copy-me');
}

async function seedAppend(root: string): Promise<void> {
  await writeReal(root, 'append/target.txt', 'original');
}

async function seedReplace(root: string): Promise<void> {
  await writeReal(root, 'replace/target.txt', 'alpha beta gamma');
}

async function seedMulti(root: string): Promise<void> {
  await writeReal(root, 'multi/a.txt', 'A');
  await writeReal(root, 'multi/b.txt', 'B');
}

async function seedMultiReplace(root: string): Promise<void> {
  await writeReal(root, 'multi-replace/a.txt', 'old A');
  await writeReal(root, 'multi-replace/b.txt', 'old B');
  await writeReal(root, 'multi-replace/skip.txt', 'nothing');
}

const CASES: readonly ParityCase[] = [
  {
    name: 'create_file',
    seed: async () => undefined,
    legacy: [{ kind: 'create_file', path: 'parity/create/a.txt', content: 'A', index: '1' }],
    tool: 'create_file',
    input: { path: 'parity/create/a.txt', content: 'A' },
  },
  {
    name: 'delete_file',
    seed: (root) => writeReal(root, 'parity/delete/a.txt', 'A'),
    legacy: [{ kind: 'delete_file', path: 'parity/delete/a.txt', index: '1' }],
    tool: 'delete_file',
    input: { path: 'parity/delete/a.txt' },
  },
  {
    name: 'rename_file',
    seed: seedRename,
    legacy: [{
      kind: 'rename_file',
      from: 'rename/from.txt',
      to: 'rename/to.txt',
      index: '1',
    }],
    tool: 'rename_file',
    input: { from: 'rename/from.txt', to: 'rename/to.txt' },
  },
  {
    name: 'move_file',
    seed: seedMove,
    legacy: [{
      kind: 'move_file',
      from: 'move/from.txt',
      to: 'move/nested/to.txt',
      index: '1',
    }],
    tool: 'move_file',
    input: { from: 'move/from.txt', to: 'move/nested/to.txt' },
  },
  {
    name: 'copy_file',
    seed: seedCopy,
    legacy: [{
      kind: 'copy_file',
      from: 'copy/from.txt',
      to: 'copy/nested/to.txt',
      index: '1',
    }],
    tool: 'copy_file',
    input: { from: 'copy/from.txt', to: 'copy/nested/to.txt' },
  },
  {
    name: 'append_file',
    seed: seedAppend,
    legacy: [{
      kind: 'append_file',
      path: 'append/target.txt',
      position: 'end',
      content: 'added',
      index: '1',
    }],
    tool: 'append_file',
    input: { path: 'append/target.txt', content: 'added' },
  },
  {
    name: 'create_directory',
    seed: async () => undefined,
    legacy: [{
      kind: 'create_directory',
      directoryPath: 'parity/dir',
      files: ['one.txt', 'nested/two.txt'],
      index: '1',
    }],
    tool: 'create_directory',
    input: { directoryPath: 'parity/dir', files: ['one.txt', 'nested/two.txt'] },
  },
  {
    name: 'delete_directory',
    seed: seedTree,
    legacy: [{ kind: 'delete_directory', directoryPath: 'seed', index: '1' }],
    tool: 'delete_directory',
    input: { directoryPath: 'seed' },
  },
  {
    name: 'move_directory',
    seed: seedTree,
    legacy: [{ kind: 'move_directory', from: 'seed', to: 'moved', index: '1' }],
    tool: 'move_directory',
    input: { from: 'seed', to: 'moved' },
  },
  {
    name: 'append_file_multi',
    seed: seedMulti,
    legacy: [{
      kind: 'append_file_multi',
      patterns: ['**/*.txt'],
      directory: 'multi',
      recursive: true,
      maxResults: 100,
      position: 'end',
      content: 'X',
      index: '1',
    }],
    tool: 'append_file_multi',
    input: { pattern: '**/*.txt', scope: 'multi', content: 'X' },
  },
  {
    name: 'search_replace',
    seed: seedReplace,
    legacy: [{
      kind: 'search_replace',
      path: 'replace/target.txt',
      search: 'beta',
      replace: 'BETA',
      index: '1',
    }],
    tool: 'search_replace',
    input: { path: 'replace/target.txt', search: 'beta', replace: 'BETA' },
  },
  {
    name: 'search_replace_multi',
    seed: seedMultiReplace,
    legacy: [{
      kind: 'search_replace_multi',
      patterns: ['**/*.txt'],
      directory: 'multi-replace',
      recursive: true,
      maxResults: 100,
      search: 'old',
      replace: 'new',
      index: '1',
    }],
    tool: 'search_replace_multi',
    input: {
      pattern: '**/*.txt',
      scope: 'multi-replace',
      search: 'old',
      replace: 'new',
    },
  },
];

describe('Goal 9 — successful branch parity', () => {
  for (const testCase of CASES) {
    it(`${testCase.name} matches the frozen legacy branch`, async () => {
      await testCase.seed(legacyRoot);
      await testCase.seed(kernel.root);

      const legacyResult = await executeFileOperations(
        [...testCase.legacy],
        legacyFs,
        [legacyRoot],
      );
      const pluginResult = await invoke(kernel, testCase.tool, testCase.input);

      const legacyOperation = legacyResult.operationResults[0];
      const pluginData = mutationData(pluginResult);

      assert.equal(legacyResult.success, true, `${testCase.name} legacy success`);
      assert.equal(legacyOperation?.status, 'success', `${testCase.name} legacy status`);
      assert.equal(pluginResult.status, 'success', `${testCase.name} plugin status`);
      assert.equal(
        pluginResult.message,
        legacyOperation?.message,
        `${testCase.name} message parity`,
      );

      const legacyTree = canonicalSnapshot(await snapshotWorkspace(legacyRoot));
      const pluginTree = canonicalSnapshot(await snapshotWorkspace(kernel.root));

      assert.equal(pluginTree, legacyTree, `${testCase.name} final tree parity`);
      assert.ok(pluginData.sessionId, `${testCase.name} plugin session id`);
    });
  }

  it('preserves the legacy multi-file skip set for search_replace_multi', async () => {
    await seedMultiReplace(legacyRoot);
    await seedMultiReplace(kernel.root);

    const legacyResult = await executeFileOperations(
      [{
        kind: 'search_replace_multi',
        patterns: ['**/*.txt'],
        directory: 'multi-replace',
        recursive: true,
        maxResults: 100,
        search: 'missing',
        replace: 'x',
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'multi-replace',
      search: 'missing',
      replace: 'x',
    });

    const legacySkipped = (legacyResult.operationResults[0]?.fileResults?.skipped ?? [])
      .map((path) => path.replace(`${legacyRoot}/`, ''))
      .sort();
    const pluginSkipped = (mutationData(pluginResult).skipped ?? [])
      .map((entry) => entry.path)
      .sort();

    assert.deepEqual(pluginSkipped, legacySkipped);
  });

  it('preserves the legacy missing-target delete_file skip message', async () => {
    const legacyResult = await executeFileOperations(
      [{ kind: 'delete_file', path: 'parity/missing.txt', index: '1' }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'delete_file', {
      path: 'parity/missing.txt',
    });

    assert.equal(legacyResult.operationResults[0]?.status, 'success');
    assert.equal(pluginResult.status, 'success');
    assert.equal(
      pluginResult.message,
      legacyResult.operationResults[0]?.message,
    );
  });

  it('records a legacy history session for a successful branch', async () => {
    const historyRoot = await makeTempDirectory('brud-fs-parity-history-');
    const store = new TestHistoryStore(historyRoot, legacyFs);

    try {
      await writeReal(legacyRoot, 'history/from.txt', 'history');
      const legacyResult = await executeFileOperations(
        [{
          kind: 'rename_file',
          from: 'history/from.txt',
          to: 'history/to.txt',
          index: '1',
        }],
        legacyFs,
        [legacyRoot],
        store,
      );

      assert.equal(legacyResult.success, true);
      const sessions = await store.getAllSessions();

      assert.ok(sessions.length > 0, 'legacy must record a session');

      await writeReal(kernel.root, 'history/from.txt', 'history');
      const pluginResult = await invoke(kernel, 'rename_file', {
        from: 'history/from.txt',
        to: 'history/to.txt',
      });
      const session = await kernel.history.getSession(mutationData(pluginResult).sessionId!);

      assert.equal(session?.status, 'committed');
    } finally {
      await removeReal(historyRoot);
    }
  });
});

describe('Goal 9 — documented and discovered divergences', () => {
  it('create_file reports CONFLICT while legacy reports FILE_ALREADY_EXISTS', async () => {
    await writeReal(legacyRoot, 'conflict/existing.txt', 'original');
    await writeReal(kernel.root, 'conflict/existing.txt', 'original');

    const legacyResult = await executeFileOperations(
      [{
        kind: 'create_file',
        path: 'conflict/existing.txt',
        content: 'overwrite',
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'create_file', {
      path: 'conflict/existing.txt',
      content: 'overwrite',
    });

    assert.equal(legacyResult.operationResults[0]?.status, 'aborted');
    assert.equal(legacyResult.operationResults[0]?.code, 'FILE_ALREADY_EXISTS');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'CONFLICT');
    assert.equal(await legacyFs.readFile(join(legacyRoot, 'conflict/existing.txt')), 'original');
    await assert.doesNotReject(async () => {
      assert.equal(await readReal(kernel.root, 'conflict/existing.txt'), 'original');
    });
  });

  it('move_directory reports CONFLICT while legacy reports DIRECTORY_ALREADY_EXISTS', async () => {
    await writeReal(legacyRoot, 'move-conflict/from/a.txt', 'a');
    await writeReal(legacyRoot, 'move-conflict/to/keep.txt', 'keep');
    await writeReal(kernel.root, 'move-conflict/from/a.txt', 'a');
    await writeReal(kernel.root, 'move-conflict/to/keep.txt', 'keep');

    const legacyResult = await executeFileOperations(
      [{
        kind: 'move_directory',
        from: 'move-conflict/from',
        to: 'move-conflict/to',
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'move_directory', {
      from: 'move-conflict/from',
      to: 'move-conflict/to',
    });

    assert.equal(legacyResult.operationResults[0]?.status, 'aborted');
    assert.equal(legacyResult.operationResults[0]?.code, 'DIRECTORY_ALREADY_EXISTS');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'CONFLICT');
  });

  it('delete_directory on a file aborts with a dedicated code in the plugin', async () => {
    await writeReal(legacyRoot, 'delete-file-as-dir.txt', 'file');
    await writeReal(kernel.root, 'delete-file-as-dir.txt', 'file');

    const legacyResult = await executeFileOperations(
      [{ kind: 'delete_directory', directoryPath: 'delete-file-as-dir.txt', index: '1' }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'delete_directory', {
      directoryPath: 'delete-file-as-dir.txt',
    });

    assert.equal(legacyResult.operationResults[0]?.status, 'success');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'CANNOT_DELETE_FILE_AS_DIRECTORY');
  });

  it('search_replace on a missing file diverges: legacy UNEXPECTED_ERROR vs plugin FILE_NOT_FOUND', async () => {
    const legacyResult = await executeFileOperations(
      [{
        kind: 'search_replace',
        path: 'missing/search.txt',
        search: 'a',
        replace: 'b',
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'search_replace', {
      path: 'missing/search.txt',
      search: 'a',
      replace: 'b',
    });

    assert.equal(legacyResult.operationResults[0]?.status, 'failed');
    assert.equal(legacyResult.operationResults[0]?.code, 'UNEXPECTED_ERROR');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'FILE_NOT_FOUND');
  });

  it('does not preserve the legacy aborted-only ⇒ success aggregate', async () => {
    await writeReal(legacyRoot, 'aborted-only/target.txt', 'no match');
    await writeReal(kernel.root, 'aborted-only/target.txt', 'no match');

    const legacyResult = await executeFileOperations(
      [{
        kind: 'search_replace',
        path: 'aborted-only/target.txt',
        search: 'absent',
        replace: 'x',
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'search_replace', {
      path: 'aborted-only/target.txt',
      search: 'absent',
      replace: 'x',
    });

    assert.equal(legacyResult.operationResults[0]?.status, 'aborted');
    assert.equal(legacyResult.success, true, 'legacy treats aborted-only as success');
    assert.equal(pluginResult.status, 'aborted', 'the plugin uses the strict kernel status');
  });

  it('uses the plugin-native envelope instead of legacy operationResults', async () => {
    await writeReal(kernel.root, 'envelope/target.txt', 'old');
    const pluginResult = await invoke(kernel, 'search_replace', {
      path: 'envelope/target.txt',
      search: 'old',
      replace: 'new',
    });
    const data = mutationData(pluginResult);
    const raw = pluginResult as unknown as {
      operationResults?: unknown;
      data?: Record<string, unknown>;
    };

    assert.equal(raw.operationResults, undefined);
    assert.ok(Array.isArray(data.files));
    assert.ok(Array.isArray(data.skipped));
    assert.ok(Array.isArray(data.errors));
    assert.equal(data.files[0]?.path, 'envelope/target.txt');
  });

  it('preserves create_directory overwrite semantics', async () => {
    await writeReal(legacyRoot, 'overwrite/existing.txt', 'old-content');
    await writeReal(kernel.root, 'overwrite/existing.txt', 'old-content');

    const legacyResult = await executeFileOperations(
      [{
        kind: 'create_directory',
        directoryPath: 'overwrite',
        files: ['existing.txt'],
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    const pluginResult = await invoke(kernel, 'create_directory', {
      directoryPath: 'overwrite',
      files: ['existing.txt'],
    });

    assert.equal(legacyResult.success, true);
    assert.equal(pluginResult.status, 'success');
    assert.equal(await legacyFs.readFile(join(legacyRoot, 'overwrite/existing.txt')), '');
    assert.equal(await readPluginFile('overwrite/existing.txt'), '');
  });

  it('append_file position:start matches legacy', async () => {
    await writeReal(legacyRoot, 'append-start/target.txt', 'original');
    await writeReal(kernel.root, 'append-start/target.txt', 'original');

    await executeFileOperations(
      [{
        kind: 'append_file',
        path: 'append-start/target.txt',
        position: 'start',
        content: 'first',
        index: '1',
      }],
      legacyFs,
      [legacyRoot],
    );
    await invoke(kernel, 'append_file', {
      path: 'append-start/target.txt',
      position: 'start',
      content: 'first',
    });

    assert.equal(
      await legacyFs.readFile(join(legacyRoot, 'append-start/target.txt')),
      'first\n\noriginal',
    );
    assert.equal(await readPluginFile('append-start/target.txt'), 'first\n\noriginal');
  });
});

function readPluginFile(path: string): Promise<string> {
  return readReal(kernel.root, path);
}