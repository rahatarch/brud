/**
 * Goal 7 — Search integration.
 *
 * The bridge is probed directly with a recording dispatch, then through the
 * real Search plugin against real files.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '@brud/kernel';
import {
  MAX_BRACE_GROUPS,
  MAX_PATTERN_LENGTH,
  resolveSearchFiles,
  validatePattern,
} from '../search/index.js';
import type { ExecuteTool } from '../search/index.js';
import { appendFileMulti } from '../groups/multi/appendFileMulti/index.js';
import { searchReplaceMulti } from '../groups/multi/searchReplaceMulti/index.js';
import {
  acquireVerificationLock,
  bootVerificationKernel,
  createRuntime,
  errorCode,
  invoke,
  readReal,
  recordingSearch,
  releaseVerificationLock,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({ prefix: 'brud-fs-verify-search-' });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

describe('Goal 7 — pattern translation', () => {
  it('wraps the singular pattern in patterns[] and names search_files', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    await resolveSearchFiles(recordingSearch(['a.txt'], calls), {
      pattern: '**/*.txt',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, 'search_files');
    assert.deepEqual(calls[0]?.input, { patterns: ['**/*.txt'] });
  });

  it('translates scope to directory', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    await resolveSearchFiles(recordingSearch([], calls), {
      pattern: '**/*.ts',
      scope: 'src/lib',
    });

    assert.deepEqual(calls[0]?.input, {
      patterns: ['**/*.ts'],
      directory: 'src/lib',
    });
  });

  it('translates exclude to excludePatterns', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    await resolveSearchFiles(recordingSearch([], calls), {
      pattern: '**/*.ts',
      exclude: ['**/*.test.ts', '**/dist/**'],
    });

    assert.deepEqual(calls[0]?.input, {
      patterns: ['**/*.ts'],
      excludePatterns: ['**/*.test.ts', '**/dist/**'],
    });
  });

  it('omits empty scope and exclude', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    await resolveSearchFiles(recordingSearch([], calls), {
      pattern: '*.md',
      scope: '',
      exclude: [],
    });

    assert.deepEqual(calls[0]?.input, { patterns: ['*.md'] });
  });

  it('deduplicates and sorts search results', async () => {
    const executeTool: ExecuteTool = async () => ({
      status: 'success',
      data: {
        results: [
          { path: 'b.txt' },
          { path: 'a.txt' },
          { path: 'b.txt' },
          { path: '' },
          { path: 7 },
        ],
      },
    });

    const paths = await resolveSearchFiles(executeTool, { pattern: '**/*.txt' });

    assert.deepEqual(paths, ['a.txt', 'b.txt']);
  });
});

describe('Goal 7 — search failure propagation', () => {
  it('maps a failed search result to SEARCH_FAILED', async () => {
    const executeTool: ExecuteTool = async () => ({
      status: 'failed',
      error: 'TOOL_NOT_FOUND: search_files',
    });

    await assert.rejects(
      () => resolveSearchFiles(executeTool, { pattern: '**/*.txt' }),
      (error: unknown) => (error as { code?: string }).code === 'SEARCH_FAILED',
    );
  });

  it('maps a thrown search dispatch to SEARCH_FAILED', async () => {
    const executeTool: ExecuteTool = async () => {
      throw new Error('transport exploded');
    };

    await assert.rejects(
      () => resolveSearchFiles(executeTool, { pattern: '**/*.txt' }),
      (error: unknown) =>
        (error as { code?: string }).code === 'SEARCH_FAILED'
        && /transport exploded/u.test((error as Error).message),
    );
  });

  it('maps an invalid search payload to SEARCH_FAILED', async () => {
    const executeTool: ExecuteTool = async () => ({
      status: 'success',
      data: { notResults: true },
    });

    await assert.rejects(
      () => resolveSearchFiles(executeTool, { pattern: '**/*.txt' }),
      (error: unknown) => (error as { code?: string }).code === 'SEARCH_FAILED',
    );
  });

  it('propagates an inactive Search plugin as SEARCH_FAILED', async () => {
    const withoutSearch = await bootVerificationKernel({
      prefix: 'brud-fs-verify-no-search-',
      withSearch: false,
    });

    try {
      await writeReal(withoutSearch.root, 'search/one.txt', 'one');
      const result = await invoke(withoutSearch, 'append_file_multi', {
        pattern: '**/*.txt',
        scope: 'search',
        content: 'X',
      });

      assert.equal(result.status, 'aborted');
      assert.equal(errorCode(result), 'SEARCH_FAILED');
      assert.equal(await readReal(withoutSearch.root, 'search/one.txt'), 'one');
    } finally {
      await withoutSearch.shutdown();
    }
  });

  it('propagates a handler-level search failure as SEARCH_FAILED', async () => {
    await writeReal(kernel.root, 'search-fail/one.txt', 'one');
    const executeTool: ExecuteTool = async (): Promise<OperationResult> => ({
      status: 'failed',
      error: 'search is offline',
    });
    const runtime = createRuntime(kernel, executeTool);
    const result = await appendFileMulti(
      { pattern: '**/*.txt', scope: 'search-fail', content: 'X' },
      runtime,
    );

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'SEARCH_FAILED');
  });
});

describe('Goal 7 — pattern validation', () => {
  it('rejects an empty pattern', () => {
    assert.throws(() => validatePattern(''));
    assert.throws(() => validatePattern('   '));
  });

  it('rejects a pattern over 1024 characters', () => {
    assert.throws(() => validatePattern('a'.repeat(MAX_PATTERN_LENGTH + 1)));
    assert.doesNotThrow(() => validatePattern('a'.repeat(MAX_PATTERN_LENGTH)));
  });

  it('rejects more than 32 brace groups', () => {
    const pattern = '{a,b}'.repeat(MAX_BRACE_GROUPS + 1);

    assert.throws(() => validatePattern(pattern));
  });
});

describe('Goal 7 — real Search integration', () => {
  it('append_file_multi appends to every real match', async () => {
    await writeReal(kernel.root, 'search-real/a.txt', 'A');
    await writeReal(kernel.root, 'search-real/nested/b.txt', 'B');
    await writeReal(kernel.root, 'search-real/ignored.md', 'M');

    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '**/*.txt',
      scope: 'search-real',
      content: 'X',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'search-real/a.txt'), 'A\n\nX');
    assert.equal(await readReal(kernel.root, 'search-real/nested/b.txt'), 'B\n\nX');
    assert.equal(await readReal(kernel.root, 'search-real/ignored.md'), 'M');
  });

  it('scope restricts Search to the requested directory', async () => {
    await writeReal(kernel.root, 'scope-one/a.txt', 'A');
    await writeReal(kernel.root, 'scope-two/b.txt', 'B');

    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '**/*.txt',
      scope: 'scope-one',
      content: 'X',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'scope-one/a.txt'), 'A\n\nX');
    assert.equal(await readReal(kernel.root, 'scope-two/b.txt'), 'B');
  });

  it('search_replace_multi replaces in every real match', async () => {
    await writeReal(kernel.root, 'search-replace/a.txt', 'old');
    await writeReal(kernel.root, 'search-replace/nested/b.txt', 'old');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'search-replace',
      search: 'old',
      replace: 'new',
    });

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, 'search-replace/a.txt'), 'new');
    assert.equal(await readReal(kernel.root, 'search-replace/nested/b.txt'), 'new');
  });

  it('returns success with zero files when Search matches nothing', async () => {
    await writeReal(kernel.root, 'search-empty/a.md', 'A');

    const result = await invoke(kernel, 'append_file_multi', {
      pattern: '**/*.txt',
      scope: 'search-empty',
      content: 'X',
    });

    assert.equal(result.status, 'success');
    const data = result.data as { files: unknown[]; skipped: unknown[] };
    assert.equal(data.files.length, 0);
    assert.equal(data.skipped.length, 0);
  });

  it('reports per-file skips for real files that do not contain the search text', async () => {
    await writeReal(kernel.root, 'search-skip/a.txt', 'match');
    await writeReal(kernel.root, 'search-skip/b.txt', 'nothing here');

    const result = await invoke(kernel, 'search_replace_multi', {
      pattern: '**/*.txt',
      scope: 'search-skip',
      search: 'match',
      replace: 'replaced',
    });

    assert.equal(result.status, 'success');
    const data = result.data as {
      files: Array<{ path: string }>;
      skipped: Array<{ path: string; code?: string }>;
    };

    assert.deepEqual(data.files.map((file) => file.path), ['search-skip/a.txt']);
    assert.deepEqual(data.skipped.map((skip) => skip.path), ['search-skip/b.txt']);
    assert.equal(data.skipped[0]?.code, 'SEARCH_NOT_FOUND');
  });
});