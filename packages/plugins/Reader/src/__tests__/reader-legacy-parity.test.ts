import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readDirectory, readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  bootReaderKernel,
  fixedCandidates,
  loadLegacyReadEngine,
  makeLegacyFileSystem,
  normalizeForParity,
  type LegacyReadEngine,
  type LegacyReadResult,
  type ReaderHarness,
} from './reader-test-helpers.js';

function assertParity(
  harness: ReaderHarness,
  readerResult: ReadResult,
  legacyResult: LegacyReadResult,
): void {
  const reader = normalizeForParity(readerResult, harness.root, { sort: true });
  const legacy = normalizeForParity(legacyResult, harness.root, { sort: true });

  assert.deepEqual(reader, legacy);
}

function absolute(harness: ReaderHarness, path: string): string {
  return join(harness.root, path);
}

async function seed(harness: ReaderHarness): Promise<{ legacy: LegacyReadEngine; fs: ReturnType<typeof makeLegacyFileSystem> }> {
  const legacy = await loadLegacyReadEngine();
  const fs = makeLegacyFileSystem(harness.fs);

  return { legacy, fs };
}

describe('Goal 6 — legacy parity', () => {
  it('fails loudly when the legacy engine cannot be loaded', async () => {
    const legacy = await loadLegacyReadEngine();

    assert.equal(typeof legacy.readFiles, 'function');
    assert.equal(typeof legacy.readDirectoryFiles, 'function');
  });

  it('matches a single unsliced file read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'line one\nline two\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a single file with a line slice', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\nfour\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      startLine: 2,
      endLine: 3,
    });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      false,
      0,
      undefined,
      undefined,
      2,
      3,
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches a start-only line slice', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', startLine: 2 });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      false,
      0,
      undefined,
      undefined,
      2,
      undefined,
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches an end-only line slice', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', endLine: 2 });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      false,
      0,
      undefined,
      undefined,
      undefined,
      2,
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches a slice whose end line clamps to EOF', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      startLine: 2,
      endLine: 99,
    });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      false,
      0,
      undefined,
      undefined,
      2,
      99,
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches a file without a trailing newline', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an empty file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/empty.txt', '');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/empty.txt' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/empty.txt')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a file containing only a newline', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/newline.txt', '\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/newline.txt' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/newline.txt')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches CRLF line endings', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/crlf.txt', 'one\r\ntwo\r\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/crlf.txt' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/crlf.txt')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a UTF-8 file with surrogate pairs', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/emoji.txt', 'rocket 🚀\nline two\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/emoji.txt' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/emoji.txt')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a binary file containing a null byte', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/image.bin', Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/image.bin' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/image.bin')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a missing file', async (t) => {
    const harness = await bootReaderKernel(t);
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/missing.txt' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/missing.txt')], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an invalid line range failure code and message', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\n');
    const { legacy, fs } = await seed(harness);
    const legacyError = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      false,
      0,
      undefined,
      undefined,
      9,
      undefined,
    ).then(() => undefined, (error: unknown) => error as { code?: string; message?: string });

    const readerResult = await harness.call('read_file', {
      filePath: 'src/a.ts',
      startLine: 9,
    });

    assert.ok(legacyError !== undefined, 'legacy engine should reject an invalid range');
    assert.equal(legacyError.code, 'INVALID_LINE_RANGE');
    assert.equal((readerResult as { code?: string }).code, 'INVALID_LINE_RANGE');
    assert.equal(readerResult.message, legacyError.message);
  });

  it('matches a single-root import read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nexport const a = true;\n");
    await harness.write('src/b.ts', 'export const b = true;\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], true, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an import read with maxDepth 1', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', "import { c } from './c';\n");
    await harness.write('src/c.ts', 'export const c = true;\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      maxDepth: 1,
    });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], true, 1);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an import read with maxDepth 2', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', "import { c } from './c';\n");
    await harness.write('src/c.ts', "import { d } from './d';\n");
    await harness.write('src/d.ts', 'export const d = true;\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      maxDepth: 2,
    });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], true, 2);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an import read with an excluded import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nimport { c } from './c';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');
    await harness.write('src/c.ts', 'export const c = true;\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      exclude: 'b.ts',
    });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      true,
      0,
      ['b.ts'],
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches an import read with a cycle', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', "import { a } from './a';\n");
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], true, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an import read with a binary import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { image } from './image.bin';\n");
    await harness.write('src/image.bin', Buffer.from([0x00, 0x01, 0x02]));
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], true, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches an import read with a custom pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', '@load ./b\n');
    await harness.write('src/b.ts', 'export const b = true;\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: String.raw`@load\s+(\S+)`,
    });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts')],
      true,
      0,
      undefined,
      [String.raw`@load\s+(\S+)`],
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches a batch of files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    await harness.write('src/c.ts', 'c\n');
    const { legacy, fs } = await seed(harness);
    const candidates = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

    const reader = await readFiles(harness.runtime(fixedCandidates(candidates)), {
      pattern: '**/*.ts',
    });
    const legacyResult = await legacy.readFiles(
      fs,
      candidates.map((candidate) => absolute(harness, candidate)),
      false,
      0,
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches a batch with mixed readable, binary, and missing files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');
    await harness.write('src/bin.dat', Buffer.from([0x00, 0x01]));
    const { legacy, fs } = await seed(harness);
    const candidates = ['src/a.txt', 'src/missing.txt', 'src/bin.dat'];

    const reader = await readFiles(harness.runtime(fixedCandidates(candidates)), {
      pattern: '**/*',
    });
    const legacyResult = await legacy.readFiles(
      fs,
      candidates.map((candidate) => absolute(harness, candidate)),
      false,
      0,
    );

    assertParity(harness, reader, legacyResult);
  });

  it('matches a non-recursive directory read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    await harness.write('src/nested/c.ts', 'c\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readDirectory(harness.runtime(), { directoryPath: 'src' });
    const legacyPaths = await legacy.readDirectoryFiles(fs, absolute(harness, 'src'), false);
    const legacyResult = await legacy.readFiles(fs, legacyPaths, false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a recursive directory read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/nested/b.ts', 'b\n');
    await harness.write('src/nested/deeper/c.ts', 'c\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readDirectory(harness.runtime(), {
      directoryPath: 'src',
      recursive: true,
    });
    const legacyPaths = await legacy.readDirectoryFiles(fs, absolute(harness, 'src'), true);
    const legacyResult = await legacy.readFiles(fs, legacyPaths, false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a recursive directory read with an exclude', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/skip-me.ts', 'skip\n');
    await harness.write('src/nested/b.ts', 'b\n');
    const { legacy, fs } = await seed(harness);

    const reader = await readDirectory(harness.runtime(), {
      directoryPath: 'src',
      recursive: true,
      exclude: 'skip-me',
    });
    const legacyPaths = await legacy.readDirectoryFiles(
      fs,
      absolute(harness, 'src'),
      true,
      ['skip-me'],
    );
    const legacyResult = await legacy.readFiles(
      fs,
      legacyPaths,
      false,
      0,
      ['skip-me'],
    );

    // The legacy directory composition filters excluded files during discovery,
    // so it has no skip entry. The Reader records the excluded candidate. The
    // delivered file set must still match exactly.
    const readerNormalized = normalizeForParity(reader, harness.root, { sort: true });
    const legacyNormalized = normalizeForParity(legacyResult, harness.root, { sort: true });
    readerNormalized.skips = (readerNormalized.skips as Array<{ reason: string }>)
      .filter((skip) => skip.reason !== 'excluded');

    assert.deepEqual(readerNormalized, legacyNormalized);
    assert.ok(reader.skips?.some(
      (skip) => skip.path === 'src/skip-me.ts' && skip.reason === 'excluded',
    ));
  });

  it('matches an empty directory', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.mkdir('empty');
    const { legacy, fs } = await seed(harness);

    const reader = await readDirectory(harness.runtime(), { directoryPath: 'empty' });
    const legacyPaths = await legacy.readDirectoryFiles(fs, absolute(harness, 'empty'), false);
    const legacyResult = await legacy.readFiles(fs, legacyPaths, false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('matches a missing directory', async (t) => {
    const harness = await bootReaderKernel(t);
    const { legacy, fs } = await seed(harness);

    const reader = await readDirectory(harness.runtime(), { directoryPath: 'missing' });
    const legacyResult = await legacy.readFiles(fs, [], false, 0);

    assertParity(harness, reader, legacyResult);
  });

  it('documents the stricter binary sniff divergence', async (t) => {
    const harness = await bootReaderKernel(t);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await harness.write('src/header.bin', pngHeader);
    const { legacy, fs } = await seed(harness);

    const reader = await readFile(harness.runtime(), { filePath: 'src/header.bin' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/header.bin')], false, 0);

    assert.equal(reader.files[0]?.isBinary, true);
    assert.equal(reader.files[0]?.content, undefined);
    assert.equal(legacyResult.files[0]?.isBinary, undefined);
    assert.equal(typeof legacyResult.files[0]?.content, 'string');
  });

  it('matches the read_file tool envelope for a representative file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\n');
    const { legacy, fs } = await seed(harness);

    const toolResult = await harness.call('read_file', { filePath: 'src/a.ts' });
    const legacyResult = await legacy.readFiles(fs, [absolute(harness, 'src/a.ts')], false, 0);

    assert.equal(toolResult.status, 'success');
    assertParity(harness, toolResult.data as ReadResult, legacyResult);
  });

  it('matches the read_files tool envelope for a representative pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    const { legacy, fs } = await seed(harness);

    const toolResult = await harness.call('read_files', { pattern: '**/*.ts' });
    const legacyResult = await legacy.readFiles(
      fs,
      [absolute(harness, 'src/a.ts'), absolute(harness, 'src/b.ts')],
      false,
      0,
    );

    assert.equal(toolResult.status, 'success');
    assertParity(harness, toolResult.data as ReadResult, legacyResult);
  });

  it('matches the read_directory tool envelope for a representative directory', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    const { legacy, fs } = await seed(harness);

    const toolResult = await harness.call('read_directory', { directoryPath: 'src' });
    const legacyPaths = await legacy.readDirectoryFiles(fs, absolute(harness, 'src'), false);
    const legacyResult = await legacy.readFiles(fs, legacyPaths, false, 0);

    assert.equal(toolResult.status, 'success');
    assertParity(harness, toolResult.data as ReadResult, legacyResult);
  });
});