/**
 * Goal 9 — Legacy parity.
 *
 * The frozen legacy engine (formerly the quarantined legacy engine's `file-operations/index.ts`)
 * was quarantined to `deprecated/` in Phase 11 (D-14/D-17). Its
 * observable outputs were captured before the move into
 * `../__tests__/fixtures/legacy-outputs.json`. The plugin is executed against
 * its real kernel workspace and compared to those frozen legacy outputs.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  canonicalSnapshot,
  errorCode,
  invoke,
  mutationData,
  readReal,
  releaseVerificationLock,
  removeReal,
  snapshotWorkspace,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';
import fixture from '../__tests__/fixtures/legacy-outputs.json' with { type: 'json' };

interface ProbeFixture {
  readonly successCases: Readonly<Record<string, {
    readonly message: string;
    readonly status: string;
    readonly tree: string;
  }>>;
  readonly multiSkip: readonly string[];
  readonly missingDeleteMessage: string;
  readonly historyRecorded: boolean;
  readonly divergences: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const legacy = fixture.probe as unknown as ProbeFixture;

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-parity-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

interface ParityCase {
  readonly name: string;
  readonly seed: () => Promise<void>;
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

async function seedTree(): Promise<void> {
  await writeReal(kernel.root, 'seed/a.txt', 'a');
  await writeReal(kernel.root, 'seed/nested/b.txt', 'b');
}

async function seedRename(): Promise<void> {
  await writeReal(kernel.root, 'rename/from.txt', 'rename-me');
}

async function seedMove(): Promise<void> {
  await writeReal(kernel.root, 'move/from.txt', 'move-me');
}

async function seedCopy(): Promise<void> {
  await writeReal(kernel.root, 'copy/from.txt', 'copy-me');
}

async function seedAppend(): Promise<void> {
  await writeReal(kernel.root, 'append/target.txt', 'original');
}

async function seedReplace(): Promise<void> {
  await writeReal(kernel.root, 'replace/target.txt', 'alpha beta gamma');
}

async function seedMulti(): Promise<void> {
  await writeReal(kernel.root, 'multi/a.txt', 'A');
  await writeReal(kernel.root, 'multi/b.txt', 'B');
}

async function seedMultiReplace(): Promise<void> {
  await writeReal(kernel.root, 'multi-replace/a.txt', 'old A');
  await writeReal(kernel.root, 'multi-replace/b.txt', 'old B');
  await writeReal(kernel.root, 'multi-replace/skip.txt', 'nothing');
}

const CASES: readonly ParityCase[] = [
  {
    name: 'create_file',
    seed: async () => undefined,
    tool: 'create_file',
    input: { path: 'parity/create/a.txt', content: 'A' },
  },
  {
    name: 'delete_file',
    seed: async () => writeReal(kernel.root, 'parity/delete/a.txt', 'A'),
    tool: 'delete_file',
    input: { path: 'parity/delete/a.txt' },
  },
  {
    name: 'rename_file',
    seed: seedRename,
    tool: 'rename_file',
    input: { from: 'rename/from.txt', to: 'rename/to.txt' },
  },
  {
    name: 'move_file',
    seed: seedMove,
    tool: 'move_file',
    input: { from: 'move/from.txt', to: 'move/nested/to.txt' },
  },
  {
    name: 'copy_file',
    seed: seedCopy,
    tool: 'copy_file',
    input: { from: 'copy/from.txt', to: 'copy/nested/to.txt' },
  },
  {
    name: 'append_file',
    seed: seedAppend,
    tool: 'append_file',
    input: { path: 'append/target.txt', content: 'added' },
  },
  {
    name: 'create_directory',
    seed: async () => undefined,
    tool: 'create_directory',
    input: { directoryPath: 'parity/dir', files: ['one.txt', 'nested/two.txt'] },
  },
  {
    name: 'delete_directory',
    seed: seedTree,
    tool: 'delete_directory',
    input: { directoryPath: 'seed' },
  },
  {
    name: 'move_directory',
    seed: seedTree,
    tool: 'move_directory',
    input: { from: 'seed', to: 'moved' },
  },
  {
    name: 'append_file_multi',
    seed: seedMulti,
    tool: 'append_file_multi',
    input: { pattern: '**/*.txt', scope: 'multi', content: 'X' },
  },
  {
    name: 'search_replace',
    seed: seedReplace,
    tool: 'search_replace',
    input: { path: 'replace/target.txt', search: 'beta', replace: 'BETA' },
  },
  {
    name: 'search_replace_multi',
    seed: seedMultiReplace,
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
      await testCase.seed();

      const pluginResult = await invoke(kernel, testCase.tool, testCase.input);
      const pluginData = mutationData(pluginResult);
      const expected = legacy.successCases[testCase.name];

      assert.ok(expected !== undefined, `${testCase.name} legacy fixture must exist`);
      assert.equal(expected.status, 'success', `${testCase.name} legacy status`);
      assert.equal(pluginResult.status, 'success', `${testCase.name} plugin status`);
      assert.equal(
        pluginResult.message,
        expected.message,
        `${testCase.name} message parity`,
      );

      const pluginTree = canonicalSnapshot(await snapshotWorkspace(kernel.root));

      assert.equal(pluginTree, expected.tree, `${testCase.name} final tree parity`);
      assert.ok(pluginData.sessionId, `${testCase.name} plugin session id`);
    });
  }

  it('preserves the legacy multi-file skip set for search_replace_multi', async () => {
    await seedMultiReplace();

    const pluginResult = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'multi-replace',
      search: 'missing',
      replace: 'x',
    });

    const pluginSkipped = (mutationData(pluginResult).skipped ?? [])
      .map((entry) => entry.path)
      .sort();

    assert.deepEqual(pluginSkipped, [...legacy.multiSkip]);
  });

  it('preserves the legacy missing-target delete_file skip message', async () => {
    const pluginResult = await invoke(kernel, 'delete_file', {
      path: 'parity/missing.txt',
    });

    assert.equal(pluginResult.status, 'success');
    assert.equal(pluginResult.message, legacy.missingDeleteMessage);
  });

  it('records a legacy history session for a successful branch', async () => {
    await writeReal(kernel.root, 'history/from.txt', 'history');
    const pluginResult = await invoke(kernel, 'rename_file', {
      from: 'history/from.txt',
      to: 'history/to.txt',
    });
    const session = await kernel.history.getSession(mutationData(pluginResult).sessionId!);

    assert.equal(legacy.historyRecorded, true, 'legacy must have recorded a session');
    assert.equal(session?.status, 'committed');
  });
});

describe('Goal 9 — documented and discovered divergences', () => {
  it('create_file reports CONFLICT while legacy reports FILE_ALREADY_EXISTS', async () => {
    await writeReal(kernel.root, 'conflict/existing.txt', 'original');

    const pluginResult = await invoke(kernel, 'create_file', {
      path: 'conflict/existing.txt',
      content: 'overwrite',
    });
    const expected = legacy.divergences.createFileConflict;

    assert.equal(expected.status, 'aborted');
    assert.equal(expected.code, 'FILE_ALREADY_EXISTS');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'CONFLICT');
    assert.equal(expected.content, 'original');
    await assert.doesNotReject(async () => {
      assert.equal(await readReal(kernel.root, 'conflict/existing.txt'), 'original');
    });
  });

  it('move_directory reports CONFLICT while legacy reports DIRECTORY_ALREADY_EXISTS', async () => {
    await writeReal(kernel.root, 'move-conflict/from/a.txt', 'a');
    await writeReal(kernel.root, 'move-conflict/to/keep.txt', 'keep');

    const pluginResult = await invoke(kernel, 'move_directory', {
      from: 'move-conflict/from',
      to: 'move-conflict/to',
    });
    const expected = legacy.divergences.moveDirectoryConflict;

    assert.equal(expected.status, 'aborted');
    assert.equal(expected.code, 'DIRECTORY_ALREADY_EXISTS');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'CONFLICT');
  });

  it('delete_directory on a file aborts with a dedicated code in the plugin', async () => {
    await writeReal(kernel.root, 'delete-file-as-dir.txt', 'file');

    const pluginResult = await invoke(kernel, 'delete_directory', {
      directoryPath: 'delete-file-as-dir.txt',
    });

    assert.equal(legacy.divergences.deleteFileAsDirectory.status, 'success');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'CANNOT_DELETE_FILE_AS_DIRECTORY');
  });

  it('search_replace on a missing file diverges: legacy UNEXPECTED_ERROR vs plugin FILE_NOT_FOUND', async () => {
    const pluginResult = await invoke(kernel, 'search_replace', {
      path: 'missing/search.txt',
      search: 'a',
      replace: 'b',
    });
    const expected = legacy.divergences.searchReplaceMissing;

    assert.equal(expected.status, 'failed');
    assert.equal(expected.code, 'UNEXPECTED_ERROR');
    assert.equal(pluginResult.status, 'aborted');
    assert.equal(errorCode(pluginResult), 'FILE_NOT_FOUND');
  });

  it('does not preserve the legacy aborted-only ⇒ success aggregate', async () => {
    await writeReal(kernel.root, 'aborted-only/target.txt', 'no match');

    const pluginResult = await invoke(kernel, 'search_replace', {
      path: 'aborted-only/target.txt',
      search: 'absent',
      replace: 'x',
    });
    const expected = legacy.divergences.abortedOnlyAggregate;

    assert.equal(expected.status, 'aborted');
    assert.equal(expected.success, true, 'legacy treats aborted-only as success');
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
    await writeReal(kernel.root, 'overwrite/existing.txt', 'old-content');

    const pluginResult = await invoke(kernel, 'create_directory', {
      directoryPath: 'overwrite',
      files: ['existing.txt'],
    });
    const expected = legacy.divergences.createDirectoryOverwrite;

    assert.equal(expected.success, true);
    assert.equal(pluginResult.status, 'success');
    assert.equal(expected.content, '');
    assert.equal(await readReal(kernel.root, 'overwrite/existing.txt'), '');
  });

  it('append_file position:start matches legacy', async () => {
    await writeReal(kernel.root, 'append-start/target.txt', 'original');

    await invoke(kernel, 'append_file', {
      path: 'append-start/target.txt',
      position: 'start',
      content: 'first',
    });

    assert.equal(legacy.divergences.appendFileStart.content, 'first\n\noriginal');
    assert.equal(await readReal(kernel.root, 'append-start/target.txt'), 'first\n\noriginal');
  });
});