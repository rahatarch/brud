import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDirectory, readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  MiB,
  bestOfAsync,
  bootReaderKernel,
  heapUsed,
  instrumentFileSystem,
  tryGc,
  writeManyFiles,
} from './reader-test-helpers.js';

describe('Goal 9 — performance', () => {
  it('completes a 100-file batch in under 2 seconds', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 100, 'x'.repeat(1024));

    const start = performance.now();
    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });
    const elapsed = performance.now() - start;

    assert.equal(result.totalFiles, 100);
    assert.ok(elapsed < 2000, `100-file batch took ${elapsed.toFixed(1)}ms`);
  });

  it('completes a 100-file glob batch in under 2 seconds', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 100, 'x'.repeat(256));

    const start = performance.now();
    const result = await readFiles(harness.runtime(), { pattern: '**/*.txt' });
    const elapsed = performance.now() - start;

    assert.equal(result.totalFiles, 100);
    assert.ok(elapsed < 2000, `100-file glob batch took ${elapsed.toFixed(1)}ms`);
  });

  it('completes a detail read in under 50ms', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a small file\n');

    const elapsed = await bestOfAsync(5, () => readFile(harness.runtime(), { filePath: 'src/a.txt' }));

    assert.ok(elapsed < 50, `detail read took ${elapsed.toFixed(1)}ms`);
  });

  it('completes a sliced detail read in under 50ms', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'one\ntwo\nthree\n');

    const elapsed = await bestOfAsync(5, () => readFile(harness.runtime(), {
      filePath: 'src/a.txt',
      startLine: 2,
      endLine: 2,
    }));

    assert.ok(elapsed < 50, `sliced detail read took ${elapsed.toFixed(1)}ms`);
  });

  it('completes a 1 MiB detail read in under 200ms', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/big.txt', Buffer.alloc(MiB, 0x61));

    const elapsed = await bestOfAsync(3, () => readFile(harness.runtime(), { filePath: 'src/big.txt' }));

    assert.ok(elapsed < 200, `1 MiB read took ${elapsed.toFixed(1)}ms`);
  });

  it('stops reading when the aggregate byte budget is hit', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.mkdir('src');

    for (let index = 0; index < 9; index += 1) {
      await harness.write(`src/part-${index}.bin`, Buffer.alloc(MiB, 0x61));
    }

    const probe = instrumentFileSystem(harness.fs);
    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, true);
    assert.equal(result.limitHit, 'bytes');
    assert.ok(probe.readCalls <= 8, `read ${probe.readCalls} files after the budget`);
    probe.restore();
  });

  it('completes 16 parallel reads in under 500ms', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 16);

    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 16 }, (_value, index) =>
        harness.call('read_file', { filePath: `src/file-${String(index).padStart(5, '0')}.txt` })),
    );
    const elapsed = performance.now() - start;

    assert.equal(results.every((result) => result.status === 'success'), true);
    assert.ok(elapsed < 500, `16 parallel reads took ${elapsed.toFixed(1)}ms`);
  });

  it('completes 100 repeated detail reads in under 1 second', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'repeat me\n');

    const start = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const result = await readFile(harness.runtime(), { filePath: 'src/a.txt' });
      assert.equal(result.totalFiles, 1);
    }
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 1000, `100 repeated reads took ${elapsed.toFixed(1)}ms`);
  });

  it('completes a 10-file import chain in under 500ms', async (t) => {
    const harness = await bootReaderKernel(t);
    for (let index = 0; index < 10; index += 1) {
      const next = index < 9
        ? `import { value${index + 1} } from './f${index + 1}';`
        : 'export const end = true;';
      await harness.write(`src/f${index}.ts`, `${next}\n`);
    }

    const start = performance.now();
    const result = await readFile(harness.runtime(), {
      filePath: 'src/f0.ts',
      isImportRead: true,
    });
    const elapsed = performance.now() - start;

    assert.equal(result.totalFiles, 10);
    assert.ok(elapsed < 500, `import chain took ${elapsed.toFixed(1)}ms`);
  });

  it('completes a 100-file batch with imports disabled in under 2 seconds', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 100, 'plain text\n');

    const start = performance.now();
    const result = await readDirectory(harness.runtime(), {
      directoryPath: 'src',
      recursive: true,
    });
    const elapsed = performance.now() - start;

    assert.equal(result.totalFiles, 100);
    assert.ok(elapsed < 2000, `recursive 100-file batch took ${elapsed.toFixed(1)}ms`);
  });

  it('keeps 100 reads under a 50 MB allocation delta', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 100, 'x'.repeat(1024));

    tryGc();
    const before = heapUsed();
    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });
    const after = heapUsed();
    const delta = after - before;

    assert.equal(result.totalFiles, 100);
    assert.ok(delta < 50 * MiB, `heap grew by ${(delta / MiB).toFixed(2)} MiB`);
  });

  it('keeps 100 repeated directory scans under a 50 MB allocation delta', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 10, 'x');

    tryGc();
    const before = heapUsed();
    for (let index = 0; index < 100; index += 1) {
      await readDirectory(harness.runtime(), { directoryPath: 'src' });
    }
    const after = heapUsed();
    const delta = after - before;

    assert.ok(delta < 50 * MiB, `heap grew by ${(delta / MiB).toFixed(2)} MiB`);
  });

  it('does not perform extra reads for repeated identical detail reads', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'one read per call\n');
    const probe = instrumentFileSystem(harness.fs);

    for (let index = 0; index < 20; index += 1) {
      await readFile(harness.runtime(), { filePath: 'src/a.txt' });
    }

    assert.equal(probe.readCalls, 20);
    probe.restore();
  });

  it('completes an 8 MiB boundary batch in under 2 seconds', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.mkdir('src');

    for (let index = 0; index < 8; index += 1) {
      await harness.write(`src/part-${index}.bin`, Buffer.alloc(MiB, 0x61));
    }

    const start = performance.now();
    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });
    const elapsed = performance.now() - start;

    assert.equal(result.truncated, false);
    assert.equal(result.totalSize, 8 * MiB);
    assert.ok(elapsed < 2000, `8 MiB batch took ${elapsed.toFixed(1)}ms`);
  });

  it('returns a detail result with the expected total size', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'abcdef\n');

    const result = await readFile(harness.runtime(), { filePath: 'src/a.txt' });

    assert.equal(result.totalSize, 7);
    assert.equal((result as ReadResult).files[0]?.size, 7);
  });
});