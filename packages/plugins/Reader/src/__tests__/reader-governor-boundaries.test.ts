import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINARY_SNIFF_BYTES,
  DEFAULT_MAX_BYTES,
  MAX_CONCURRENCY,
  MAX_FILES_PER_BATCH,
} from '../governor.js';
import { readDirectory, readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  MiB,
  bootReaderKernel,
  fixedCandidates,
  instrumentFileSystem,
  writeManyFiles,
  type ReaderHarness,
} from './reader-test-helpers.js';

function delivered(result: ReadResult): number {
  return result.totalFiles;
}

async function makeSizedFiles(
  harness: ReaderHarness,
  directory: string,
  sizes: readonly number[],
): Promise<void> {
  await harness.mkdir(directory);

  for (let index = 0; index < sizes.length; index += 1) {
    await harness.write(`${directory}/part-${String(index).padStart(3, '0')}.bin`, Buffer.alloc(sizes[index]!, 0x61));
  }
}

describe('Goal 3 — governor boundaries', () => {
  it('exposes the ratified governor constants', () => {
    assert.equal(MAX_FILES_PER_BATCH, 100);
    assert.equal(DEFAULT_MAX_BYTES, 8 * MiB);
    assert.equal(MAX_CONCURRENCY, 16);
    assert.equal(BINARY_SNIFF_BYTES, 8192);
  });

  it('admits a 99-file batch', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 99);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(delivered(result), 99);
    assert.equal(result.truncated, false);
  });

  it('admits a 100-file batch at the cap', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 100);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(delivered(result), 100);
    assert.equal(result.truncated, false);
  });

  it('refuses a 101-file batch with BATCH_LIMIT_EXCEEDED', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 101);

    const result = await harness.call('read_directory', { directoryPath: 'src' });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'BATCH_LIMIT_EXCEEDED');
    assert.equal(result.message, 'Read batch too large.');
  });

  it('refuses a 1,000-file batch with BATCH_LIMIT_EXCEEDED', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 1000);

    const result = await harness.call('read_directory', { directoryPath: 'src' });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'BATCH_LIMIT_EXCEEDED');
  });

  it('refuses at the governor gate before any file read', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 101);
    const probe = instrumentFileSystem(harness.fs);

    const result = await harness.call('read_directory', { directoryPath: 'src' });

    assert.equal(result.status, 'failed');
    assert.equal(probe.readCalls, 0);
    assert.equal(probe.statCalls, 0);
    probe.restore();
  });

  it('counts candidates before exclusion filtering', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 101);

    const result = await harness.call('read_directory', {
      directoryPath: 'src',
      exclude: 'file-',
    });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'BATCH_LIMIT_EXCEEDED');
  });

  it('admits 100 candidates when some are excluded', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 100);

    const result = await harness.call('read_directory', {
      directoryPath: 'src',
      exclude: 'file-00000',
    });
    const data = result.data as ReadResult;

    assert.equal(result.status, 'success');
    assert.equal(data.totalFiles, 99);
    assert.equal(data.skips?.filter((skip) => skip.reason === 'excluded').length, 1);
  });

  it('refuses 101 deterministic candidates before stat or read', async (t) => {
    const harness = await bootReaderKernel(t);
    const candidates = Array.from({ length: 101 }, (_value, index) => `virtual/${index}.txt`);
    const probe = instrumentFileSystem(harness.fs);

    await assert.rejects(
      () => readFiles(harness.runtime(fixedCandidates(candidates)), { pattern: '**/*.txt' }),
      (error: unknown) => (error as { code?: string }).code === 'BATCH_LIMIT_EXCEEDED',
    );
    assert.equal(probe.statCalls, 0);
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('refuses 10,000 deterministic candidates before stat or read', async (t) => {
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

  it('admits an aggregate of 8 MiB - 1 with truncated false', async (t) => {
    const harness = await bootReaderKernel(t);
    await makeSizedFiles(harness, 'src', [MiB, MiB, MiB, MiB, MiB, MiB, MiB, MiB - 1]);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, false);
    assert.equal(result.totalSize, 8 * MiB - 1);
    assert.equal(result.totalFiles, 8);
  });

  it('admits an aggregate of exactly 8 MiB with truncated false', async (t) => {
    const harness = await bootReaderKernel(t);
    await makeSizedFiles(harness, 'src', [MiB, MiB, MiB, MiB, MiB, MiB, MiB, MiB]);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, false);
    assert.equal(result.limitHit, undefined);
    assert.equal(result.totalSize, 8 * MiB);
    assert.equal(result.totalFiles, 8);
  });

  it('flags 8 MiB + 1 with truncated true and limitHit bytes', async (t) => {
    const harness = await bootReaderKernel(t);
    await makeSizedFiles(harness, 'src', [MiB, MiB, MiB, MiB, MiB, MiB, MiB, MiB, 1]);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, true);
    assert.equal(result.limitHit, 'bytes');
    assert.ok(result.totalSize <= 8 * MiB);
    assert.equal(result.totalFiles, 8);
  });

  it('never delivers more than 8 MiB when truncated', async (t) => {
    const harness = await bootReaderKernel(t);
    await makeSizedFiles(harness, 'src', [MiB, MiB, MiB, MiB, MiB, MiB, MiB, MiB, MiB, MiB]);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, true);
    assert.equal(result.limitHit, 'bytes');
    assert.ok(result.totalSize <= 8 * MiB);
  });

  it('refuses an oversized first candidate before reading it', async (t) => {
    const harness = await bootReaderKernel(t);
    await makeSizedFiles(harness, 'src', [8 * MiB + 1]);
    const probe = instrumentFileSystem(harness.fs);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, true);
    assert.equal(result.limitHit, 'bytes');
    assert.equal(result.totalFiles, 0);
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('stops admitting after the first candidate that overflows the budget', async (t) => {
    const harness = await bootReaderKernel(t);
    await makeSizedFiles(harness, 'src', [MiB, 8 * MiB]);

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.truncated, true);
    assert.equal(result.limitHit, 'bytes');
    assert.equal(result.totalFiles, 1);
    assert.equal(result.totalSize, MiB);
  });

  it('clamps a single oversized read_file result', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('big.txt', Buffer.alloc(8 * MiB + 1, 0x61));

    const result = await readFile(harness.runtime(), { filePath: 'big.txt' });

    assert.equal(result.files.length, 0);
    assert.equal(result.truncated, true);
    assert.equal(result.limitHit, 'bytes');
  });

  it('delivers a small line slice from an oversized file', async (t) => {
    const harness = await bootReaderKernel(t);
    const body = `${'a'.repeat(9 * MiB)}\nsecond\n`;
    await harness.write('big.txt', body);

    const result = await readFile(harness.runtime(), {
      filePath: 'big.txt',
      startLine: 2,
      endLine: 2,
    });

    assert.equal(result.files.length, 1);
    assert.equal(result.files[0]?.content, 'second\n');
    assert.equal(result.truncated, false);
  });

  it('never exceeds 16 simultaneous reads', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 20);
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 10;

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(result.totalFiles, 20);
    assert.ok(probe.maxInFlight <= MAX_CONCURRENCY, `saw ${probe.maxInFlight} in flight`);
    probe.restore();
  });

  it('runs reads with more than one lane', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 20);
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 10;

    await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.ok(probe.maxInFlight > 1, `saw ${probe.maxInFlight} in flight`);
    probe.restore();
  });

  it('saturates exactly the 16-lane chunk', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 20);
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 5;

    await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assert.equal(probe.maxInFlight, MAX_CONCURRENCY);
    probe.restore();
  });

  it('preserves input order when completion order differs', async (t) => {
    const harness = await bootReaderKernel(t);
    await writeManyFiles(harness, 'src', 20);
    const entries = await harness.fs.readDirectory('src');
    const expected = entries
      .filter((entry) => entry.isFile)
      .map((entry) => `src/${entry.name}`);
    let index = 0;
    const original = harness.fs.readFile.bind(harness.fs);
    (harness.fs as unknown as { readFile: (path: string) => Promise<Uint8Array> }).readFile = async (
      path: string,
    ) => {
      const wait = index++ % 5;
      await new Promise((resolve) => setTimeout(resolve, wait));
      return original(path);
    };

    const result = await readDirectory(harness.runtime(), { directoryPath: 'src' });
    const paths = result.files.map((file) => file.path);

    assert.deepEqual(paths, expected);
    (harness.fs as unknown as { readFile: typeof original }).readFile = original;
  });

  it('classifies a null byte at offset 8191 as binary', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.alloc(8192, 0x61);
    bytes[8191] = 0x00;
    await harness.write('sniff.bin', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.bin' });

    assert.equal(result.files[0]?.isBinary, true);
    assert.equal(result.files[0]?.content, undefined);
  });

  it('classifies 8192 text bytes with a null in the window as binary', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.alloc(8192, 0x61);
    bytes[100] = 0x00;
    await harness.write('sniff.bin', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.bin' });

    assert.equal(result.files[0]?.isBinary, true);
    assert.equal(result.files[0]?.totalLines, 0);
    assert.equal(result.files[0]?.startLine, 0);
    assert.equal(result.files[0]?.endLine, 0);
    assert.deepEqual(result.skips, [{ path: 'sniff.bin', reason: 'binary' }]);
  });

  it('ignores a null byte at offset 8192, outside the sniff window', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.alloc(8193, 0x61);
    bytes[8192] = 0x00;
    await harness.write('sniff.txt', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.txt' });

    assert.equal(result.files[0]?.isBinary, undefined);
    assert.equal(result.files[0]?.content, bytes.toString('utf8'));
  });

  it('classifies a lone high byte inside the window as binary (invalid UTF-8)', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.alloc(8192, 0x61);
    bytes[8191] = 0xff;
    await harness.write('sniff.bin', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.bin' });

    assert.equal(result.files[0]?.isBinary, true);
    assert.equal(result.files[0]?.content, undefined);
  });

  it('keeps a valid UTF-8 high-byte sequence inside the window as text', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.concat([Buffer.alloc(8190, 0x61), Buffer.from('é', 'utf8')]);
    await harness.write('sniff.txt', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.txt' });

    assert.equal(result.files[0]?.isBinary, undefined);
    assert.equal(result.files[0]?.content, bytes.toString('utf8'));
  });

  it('ignores an invalid high byte at offset 8192, outside the window', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.alloc(8193, 0x61);
    bytes[8192] = 0xff;
    await harness.write('sniff.txt', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.txt' });

    assert.equal(result.files[0]?.isBinary, undefined);
  });

  it('keeps a 8191-byte ASCII file text', async (t) => {
    const harness = await bootReaderKernel(t);
    const bytes = Buffer.alloc(8191, 0x61);
    await harness.write('sniff.txt', bytes);

    const result = await readFile(harness.runtime(), { filePath: 'sniff.txt' });

    assert.equal(result.files[0]?.isBinary, undefined);
    assert.equal(result.files[0]?.size, 8191);
  });
});