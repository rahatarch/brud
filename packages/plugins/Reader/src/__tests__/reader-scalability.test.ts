import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDirectory, readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  MiB,
  READER_PLUGIN_ID,
  bootReaderKernel,
  fixedCandidates,
  heapUsed,
  instrumentFileSystem,
  tryGc,
  withTimeout,
  writeManyFiles,
  type ReaderHarness,
} from './reader-test-helpers.js';

function contentOf(result: { data?: unknown }): string | undefined {
  return (result.data as ReadResult | undefined)?.files[0]?.content;
}

describe('Goal 10 — scalability', () => {
  it('refuses a 10,000-candidate list at the governor gate without stat or read', async (t) => {
    const harness = await bootReaderKernel(t);
    const candidates = Array.from({ length: 10_000 }, (_value, index) => `virtual/${index}.txt`);
    const probe = instrumentFileSystem(harness.fs);

    await assert.rejects(
      () => readFiles(harness.runtime(fixedCandidates(candidates)), { pattern: '**/*.txt' }),
      (error: unknown) => (error as { code?: string }).code === 'BATCH_LIMIT_EXCEEDED',
    );
    assert.equal(probe.statCalls, 0);
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('completes 100 concurrent read_file invocations', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 10);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_value, index) =>
        harness.call('read_file', {
          filePath: `src/file-${String(index % 10).padStart(5, '0')}.txt`,
        })),
    );

    assert.equal(results.length, 100);
    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(new Set(results.map((result) => contentOf(result))).size, 1);
  });

  it('completes 100 concurrent reads of the same file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'same content\n');

    const results = await Promise.all(
      Array.from({ length: 100 }, () => harness.call('read_file', { filePath: 'src/a.txt' })),
    );

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(results.every((result) => contentOf(result) === 'same content\n'), true);
  });

  it('completes 100 concurrent import reads', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        harness.call('read_file', { filePath: 'src/a.ts', isImportRead: true })),
    );

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(results.every((result) => (result.data as ReadResult).totalFiles === 2), true);
  });

  it('keeps memory stable across 1,000 detail-read cycles', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'cycle\n');

    tryGc();
    const before = heapUsed();

    for (let index = 0; index < 1000; index += 1) {
      const result = await readFile(harness.runtime(), { filePath: 'src/a.txt' });
      assert.equal(result.totalFiles, 1);
    }

    tryGc();
    const after = heapUsed();
    const delta = after - before;

    assert.ok(delta < 32 * MiB, `heap grew by ${(delta / MiB).toFixed(2)} MiB`);
  });

  it('keeps memory stable across 1,000 list/read cycles', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 3);

    tryGc();
    const before = heapUsed();

    for (let index = 0; index < 1000; index += 1) {
      const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });
      assert.equal(result.totalFiles, 3);
    }

    tryGc();
    const after = heapUsed();
    const delta = after - before;

    assert.ok(delta < 32 * MiB, `heap grew by ${(delta / MiB).toFixed(2)} MiB`);
  });

  it('isolates two kernels in the same process', async (t) => {
    const first = await bootReaderKernel(t, { prefix: 'brud-reader-a-' });
    const second = await bootReaderKernel(t, { prefix: 'brud-reader-b-' });
    await first.write('src/a.txt', 'first kernel\n');
    await second.write('src/a.txt', 'second kernel\n');

    const firstResult = await first.call('read_file', { filePath: 'src/a.txt' });
    const secondResult = await second.call('read_file', { filePath: 'src/a.txt' });

    assert.equal(contentOf(firstResult), 'first kernel\n');
    assert.equal(contentOf(secondResult), 'second kernel\n');
  });

  it('registers Reader tools independently in two kernels', async (t) => {
    const first = await bootReaderKernel(t, { prefix: 'brud-reader-a-' });
    const second = await bootReaderKernel(t, { prefix: 'brud-reader-b-' });

    assert.ok(first.tools.getTool('read_file') !== undefined);
    assert.ok(second.tools.getTool('read_file') !== undefined);
    assert.notEqual(first.kernel, second.kernel);
  });

  it('keeps the second kernel working after the first shuts down', async (t) => {
    const first = await bootReaderKernel(t, { prefix: 'brud-reader-a-' });
    const second = await bootReaderKernel(t, { prefix: 'brud-reader-b-' });
    await second.write('src/a.txt', 'survivor\n');

    await first.cleanup();

    const result = await second.call('read_file', { filePath: 'src/a.txt' });
    assert.equal(contentOf(result), 'survivor\n');
  });

  it('returns aborted for a pre-aborted signal', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');
    const controller = new AbortController();
    controller.abort();

    const result = await harness.call('read_file', { filePath: 'src/a.txt' }, controller.signal);

    assert.equal(result.status, 'aborted');
  });

  it('stops a long batch promptly when aborted mid-flight', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 40);
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 40;
    const controller = new AbortController();

    const start = performance.now();
    const pending = harness.call('read_directory', { directoryPath: 'src' }, controller.signal);
    setTimeout(() => controller.abort(), 30);
    const result = await withTimeout(pending, 2000, 'aborted batch');
    const elapsed = performance.now() - start;

    assert.equal(result.status, 'aborted');
    assert.ok(elapsed < 1000, `aborted batch took ${elapsed.toFixed(1)}ms`);
    probe.restore();
  });

  it('stops a long glob batch promptly when aborted', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 40);
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 40;
    const controller = new AbortController();

    const pending = harness.call('read_files', { pattern: '**/*.txt' }, controller.signal);
    setTimeout(() => controller.abort(), 30);
    const result = await withTimeout(pending, 2000, 'aborted glob batch');

    assert.equal(result.status, 'aborted');
    probe.restore();
  });

  it('settles gracefully when the Reader plugin deactivates during a batch', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 40);
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 40;

    const pending = harness.call('read_directory', { directoryPath: 'src' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await harness.manager.deactivatePlugin(READER_PLUGIN_ID);
    const result = await withTimeout(pending, 2000, 'deactivated batch');

    assert.ok(result.status === 'success' || result.status === 'aborted');
    probe.restore();
  });

  it('unregisters Reader tools after deactivation', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');

    await harness.manager.deactivatePlugin(READER_PLUGIN_ID);

    const result = await harness.call('read_file', { filePath: 'src/a.txt' });

    assert.equal(result.status, 'failed');
    assert.equal(harness.tools.getTool('read_file'), undefined);
    assert.ok(harness.tools.getTool('search_files') !== undefined);
  });

  it('completes 100 concurrent directory reads', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 5);

    const results = await Promise.all(
      Array.from({ length: 100 }, () => harness.call('read_directory', { directoryPath: 'src' })),
    );

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(results.every((result) => (result.data as ReadResult).totalFiles === 5), true);
  });

  it('keeps the aggregate size bounded across concurrent batches', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 20, 'x');

    const results = await Promise.all(
      Array.from({ length: 20 }, () => harness.call('read_directory', { directoryPath: 'src' })),
    );

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.equal(
      results.every((result) => {
        const data = result.data as ReadResult;
        return data.totalSize <= 8 * MiB && data.totalFiles === 20;
      }),
      true,
    );
  });
});