import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFiles } from '../readEngine.js';
import type { ReaderRuntime } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  bootReaderKernel,
  duplicateCandidates,
  failingCandidates,
  fixedCandidates,
  type ReaderHarness,
} from './reader-test-helpers.js';

interface Captured {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

function capturingDispatch(
  results: readonly string[],
  captured: Captured[],
): ReaderRuntime['executeTool'] {
  return async (name, input): Promise<{ status: string; data: unknown }> => {
    captured.push({ name, input });

    return {
      status: 'success',
      data: {
        results: results.map((path) => ({ path })),
        totalMatches: results.length,
        truncated: false,
      },
    };
  };
}

function paths(result: ReadResult): string[] {
  return result.files.map((file) => file.path);
}

async function seedWildcards(harness: ReaderHarness): Promise<void> {
  await harness.write('src/a.ts', 'a\n');
  await harness.write('src/b.ts', 'b\n');
  await harness.write('src/b.js', 'b\n');
  await harness.write('src/nested/c.ts', 'c\n');
  await harness.write('src/nested/d.js', 'd\n');
}

describe('Goal 5 — search integration', () => {
  it('resolves candidates through search_files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await readFiles(harness.runtime(), { pattern: '**/*.ts' });

    assert.deepEqual(paths(result), ['src/a.ts']);
  });

  it('sends patterns, directory, and maxResults to search_files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const captured: Captured[] = [];
    const runtime = harness.runtime(capturingDispatch(['src/a.ts'], captured));

    await readFiles(runtime, { pattern: '**/*.ts', scope: 'src', maxResults: 7 });

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.name, 'search_files');
    assert.deepEqual(captured[0]?.input, {
      patterns: ['**/*.ts'],
      directory: 'src',
      maxResults: 7,
    });
  });

  it('omits directory and maxResults when they are not supplied', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const captured: Captured[] = [];
    const runtime = harness.runtime(capturingDispatch(['src/a.ts'], captured));

    await readFiles(runtime, { pattern: '**/*.ts' });

    assert.deepEqual(captured[0]?.input, { patterns: ['**/*.ts'] });
  });

  it('normalizes ./scope before dispatch', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const captured: Captured[] = [];
    const runtime = harness.runtime(capturingDispatch(['src/a.ts'], captured));

    await readFiles(runtime, { pattern: '**/*.ts', scope: './src' });

    assert.equal(captured[0]?.input.directory, 'src');
  });

  it('normalizes an absolute scope inside the workspace', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const captured: Captured[] = [];
    const runtime = harness.runtime(capturingDispatch(['src/a.ts'], captured));

    await readFiles(runtime, { pattern: '**/*.ts', scope: join(harness.root, 'src') });

    assert.equal(captured[0]?.input.directory, 'src');
  });

  it('rejects a traversal scope before dispatching search', async (t) => {
    const harness = await bootReaderKernel(t);
    const captured: Captured[] = [];
    const runtime = harness.runtime(capturingDispatch([], captured));

    await assert.rejects(
      () => readFiles(runtime, { pattern: '**/*.ts', scope: '..' }),
      (error: unknown) => (error as { code?: string }).code === 'WORKSPACE_PATH_VIOLATION',
    );
    assert.equal(captured.length, 0);
  });

  it('propagates a search failure as SEARCH_FAILED', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const result = await harness.call('read_files', { pattern: '[z-a]' });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'SEARCH_FAILED');
    assert.match(String(result.message), /Range out of order/u);
  });

  it('propagates a failed dispatch result as SEARCH_FAILED', async (t) => {
    const harness = await bootReaderKernel(t);

    await assert.rejects(
      () => readFiles(harness.runtime(failingCandidates('search exploded')), { pattern: '**/*.ts' }),
      (error: unknown) => (error as { code?: string }).code === 'SEARCH_FAILED'
        && (error as Error).message === 'search exploded',
    );
  });

  it('deduplicates duplicate search results preserving first-seen order', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    const runtime = harness.runtime(duplicateCandidates(['src/b.ts', 'src/a.ts']));

    const result = await readFiles(runtime, { pattern: '**/*.ts' });

    assert.deepEqual(paths(result), ['src/b.ts', 'src/a.ts']);
  });

  it('ignores non-path search entries', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const runtime = harness.runtime(duplicateCandidates(['src/a.ts']));

    const result = await readFiles(runtime, { pattern: '**/*.ts' });

    assert.deepEqual(paths(result), ['src/a.ts']);
  });

  it('returns an empty successful result for an empty search result', async (t) => {
    const harness = await bootReaderKernel(t);
    const result = await readFiles(harness.runtime(fixedCandidates([])), { pattern: '**/*.ts' });

    assert.deepEqual(result, {
      files: [],
      totalFiles: 0,
      totalSize: 0,
      skips: [],
      truncated: false,
      limitHit: undefined,
    });
  });

  it('returns an empty successful result for a non-matching glob', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await harness.call('read_files', { pattern: '**/*.nomatch' });

    assert.equal(result.status, 'success');
    assert.equal((result.data as ReadResult).totalFiles, 0);
  });

  it('honors maxResults through the real search tool', async (t) => {
    const harness = await bootReaderKernel(t);
    for (let index = 0; index < 5; index += 1) {
      await harness.write(`src/f${index}.txt`, `f${index}\n`);
    }

    const result = await harness.call('read_files', { pattern: '**/*.txt', maxResults: 2 });

    assert.equal(result.status, 'success');
    assert.equal((result.data as ReadResult).totalFiles, 2);
  });

  it('matches nested files with **/*.ts', async (t) => {
    const harness = await bootReaderKernel(t);
    await seedWildcards(harness);

    const result = await readFiles(harness.runtime(), { pattern: '**/*.ts' });

    assert.deepEqual(paths(result).sort(), ['src/a.ts', 'src/b.ts', 'src/nested/c.ts']);
  });

  it('matches only top-level files with *.js', async (t) => {
    const harness = await bootReaderKernel(t);
    await seedWildcards(harness);
    await harness.write('root.js', 'root\n');

    const result = await readFiles(harness.runtime(), { pattern: '*.js' });

    assert.deepEqual(paths(result), ['root.js']);
  });

  it('matches one level with src/*.ts', async (t) => {
    const harness = await bootReaderKernel(t);
    await seedWildcards(harness);

    const result = await readFiles(harness.runtime(), { pattern: 'src/*.ts' });

    assert.deepEqual(paths(result).sort(), ['src/a.ts', 'src/b.ts']);
  });

  it('supports brace alternatives', async (t) => {
    const harness = await bootReaderKernel(t);
    await seedWildcards(harness);

    const result = await readFiles(harness.runtime(), { pattern: 'src/{a,b}.ts' });

    assert.deepEqual(paths(result).sort(), ['src/a.ts', 'src/b.ts']);
  });

  it('supports comma-separated pattern lists', async (t) => {
    const harness = await bootReaderKernel(t);
    await seedWildcards(harness);

    const result = await readFiles(harness.runtime(), { pattern: 'src/a.ts,src/b.js' });

    assert.deepEqual(paths(result).sort(), ['src/a.ts', 'src/b.js']);
  });

  it('preserves the search result order', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    const runtime = harness.runtime(fixedCandidates(['src/b.ts', 'src/a.ts']));

    const result = await readFiles(runtime, { pattern: '**/*.ts' });

    assert.deepEqual(paths(result), ['src/b.ts', 'src/a.ts']);
  });

  it('calls search_files exactly once per read_files invocation', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const captured: Captured[] = [];
    const runtime = harness.runtime(capturingDispatch(['src/a.ts'], captured));

    await readFiles(runtime, { pattern: '**/*.ts' });

    assert.equal(captured.filter((entry) => entry.name === 'search_files').length, 1);
  });
});