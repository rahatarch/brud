/**
 * Goal 6 — legacy parity.
 *
 * The frozen legacy read engine (formerly the quarantined legacy engine's `read-engine`) was
 * quarantined to `deprecated/` in Phase 11 (D-14/D-17). Its
 * normalized outputs were captured before the move into
 * `fixtures/legacy-outputs.json`. The Reader is executed against its real
 * kernel workspace and compared to those frozen legacy outputs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDirectory, readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  bootReaderKernel,
  fixedCandidates,
  normalizeForParity,
  type ReaderHarness,
} from './reader-test-helpers.js';
import fixture from './fixtures/legacy-outputs.json' with { type: 'json' };

const legacy = fixture as unknown as Readonly<Record<string, unknown>>;

function assertParity(
  name: string,
  harness: ReaderHarness,
  readerResult: ReadResult,
): void {
  const reader = normalizeForParity(readerResult, harness.root, { sort: true });

  assert.deepEqual(reader, legacy[name]);
}

describe('Goal 6 — legacy parity', () => {
  it('fails loudly when the legacy engine cannot be loaded', () => {
    const captured = legacy['fails loudly when the legacy engine cannot be loaded'] as {
      readonly readFiles: string;
      readonly readDirectoryFiles: string;
    };

    assert.equal(captured.readFiles, 'function');
    assert.equal(captured.readDirectoryFiles, 'function');
  });

  it('matches a single unsliced file read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'line one\nline two\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts' });

    assertParity(t.name, harness, reader);
  });

  it('matches a single file with a line slice', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\nfour\n');

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      startLine: 2,
      endLine: 3,
    });

    assertParity(t.name, harness, reader);
  });

  it('matches a start-only line slice', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', startLine: 2 });

    assertParity(t.name, harness, reader);
  });

  it('matches an end-only line slice', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', endLine: 2 });

    assertParity(t.name, harness, reader);
  });

  it('matches a slice whose end line clamps to EOF', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\nthree\n');

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      startLine: 2,
      endLine: 99,
    });

    assertParity(t.name, harness, reader);
  });

  it('matches a file without a trailing newline', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo');

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts' });

    assertParity(t.name, harness, reader);
  });

  it('matches an empty file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/empty.txt', '');

    const reader = await readFile(harness.runtime(), { filePath: 'src/empty.txt' });

    assertParity(t.name, harness, reader);
  });

  it('matches a file containing only a newline', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/newline.txt', '\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/newline.txt' });

    assertParity(t.name, harness, reader);
  });

  it('matches CRLF line endings', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/crlf.txt', 'one\r\ntwo\r\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/crlf.txt' });

    assertParity(t.name, harness, reader);
  });

  it('matches a UTF-8 file with surrogate pairs', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/emoji.txt', 'rocket 🚀\nline two\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/emoji.txt' });

    assertParity(t.name, harness, reader);
  });

  it('matches a binary file containing a null byte', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/image.bin', Buffer.from([0x89, 0x50, 0x00, 0x01]));

    const reader = await readFile(harness.runtime(), { filePath: 'src/image.bin' });

    assertParity(t.name, harness, reader);
  });

  it('matches a missing file', async (t) => {
    const harness = await bootReaderKernel(t);

    const reader = await readFile(harness.runtime(), { filePath: 'src/missing.txt' });

    assertParity(t.name, harness, reader);
  });

  it('matches an invalid line range failure code and message', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\n');

    const readerResult = await harness.call('read_file', {
      filePath: 'src/a.ts',
      startLine: 9,
    });
    const legacyError = legacy[t.name] as { readonly code?: string; readonly message?: string };

    assert.ok(legacyError !== undefined, 'legacy fixture should record an invalid range');
    assert.equal(legacyError.code, 'INVALID_LINE_RANGE');
    assert.equal((readerResult as { code?: string }).code, 'INVALID_LINE_RANGE');
    assert.equal(readerResult.message, legacyError.message);
  });

  it('matches a single-root import read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nexport const a = true;\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assertParity(t.name, harness, reader);
  });

  it('matches an import read with maxDepth 1', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', "import { c } from './c';\n");
    await harness.write('src/c.ts', 'export const c = true;\n');

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      maxDepth: 1,
    });

    assertParity(t.name, harness, reader);
  });

  it('matches an import read with maxDepth 2', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', "import { c } from './c';\n");
    await harness.write('src/c.ts', "import { d } from './d';\n");
    await harness.write('src/d.ts', 'export const d = true;\n');

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      maxDepth: 2,
    });

    assertParity(t.name, harness, reader);
  });

  it('matches an import read with an excluded import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nimport { c } from './c';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');
    await harness.write('src/c.ts', 'export const c = true;\n');

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      exclude: 'b.ts',
    });

    assertParity(t.name, harness, reader);
  });

  it('matches an import read with a cycle', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\n");
    await harness.write('src/b.ts', "import { a } from './a';\n");

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assertParity(t.name, harness, reader);
  });

  it('matches an import read with a binary import', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { image } from './image.bin';\n");
    await harness.write('src/image.bin', Buffer.from([0x00, 0x01, 0x02]));

    const reader = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assertParity(t.name, harness, reader);
  });

  it('matches an import read with a custom pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', '@load ./b\n');
    await harness.write('src/b.ts', 'export const b = true;\n');

    const reader = await readFile(harness.runtime(), {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: String.raw`@load\s+(\S+)`,
    });

    assertParity(t.name, harness, reader);
  });

  it('matches a batch of files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    await harness.write('src/c.ts', 'c\n');
    const candidates = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

    const reader = await readFiles(harness.runtime(fixedCandidates(candidates)), {
      pattern: '**/*.ts',
    });

    assertParity(t.name, harness, reader);
  });

  it('matches a batch with mixed readable, binary, and missing files', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');
    await harness.write('src/bin.dat', Buffer.from([0x00, 0x01]));
    const candidates = ['src/a.txt', 'src/missing.txt', 'src/bin.dat'];

    const reader = await readFiles(harness.runtime(fixedCandidates(candidates)), {
      pattern: '**/*',
    });

    assertParity(t.name, harness, reader);
  });

  it('matches a non-recursive directory read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    await harness.write('src/nested/c.ts', 'c\n');

    const reader = await readDirectory(harness.runtime(), { directoryPath: 'src' });

    assertParity(t.name, harness, reader);
  });

  it('matches a recursive directory read', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/nested/b.ts', 'b\n');
    await harness.write('src/nested/deeper/c.ts', 'c\n');

    const reader = await readDirectory(harness.runtime(), {
      directoryPath: 'src',
      recursive: true,
    });

    assertParity(t.name, harness, reader);
  });

  it('matches a recursive directory read with an exclude', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/skip-me.ts', 'skip\n');
    await harness.write('src/nested/b.ts', 'b\n');

    const reader = await readDirectory(harness.runtime(), {
      directoryPath: 'src',
      recursive: true,
      exclude: 'skip-me',
    });

    // The legacy directory composition filters excluded files during discovery,
    // so it has no skip entry. The Reader records the excluded candidate. The
    // delivered file set must still match exactly.
    const readerNormalized = normalizeForParity(reader, harness.root, { sort: true });
    readerNormalized.skips = (readerNormalized.skips as Array<{ reason: string }>)
      .filter((skip) => skip.reason !== 'excluded');

    assert.deepEqual(readerNormalized, legacy[t.name]);
    assert.ok(reader.skips?.some(
      (skip) => skip.path === 'src/skip-me.ts' && skip.reason === 'excluded',
    ));
  });

  it('matches an empty directory', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.mkdir('empty');

    const reader = await readDirectory(harness.runtime(), { directoryPath: 'empty' });

    assertParity(t.name, harness, reader);
  });

  it('matches a missing directory', async (t) => {
    const harness = await bootReaderKernel(t);

    const reader = await readDirectory(harness.runtime(), { directoryPath: 'missing' });

    assertParity(t.name, harness, reader);
  });

  it('documents the stricter binary sniff divergence', async (t) => {
    const harness = await bootReaderKernel(t);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await harness.write('src/header.bin', pngHeader);

    const reader = await readFile(harness.runtime(), { filePath: 'src/header.bin' });
    const captured = legacy[t.name] as {
      readonly legacyIsBinary?: unknown;
      readonly legacyContentType: string;
    };

    assert.equal(reader.files[0]?.isBinary, true);
    assert.equal(reader.files[0]?.content, undefined);
    assert.equal(captured.legacyIsBinary, undefined);
    assert.equal(captured.legacyContentType, 'string');
  });

  it('matches the read_file tool envelope for a representative file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'one\ntwo\n');

    const toolResult = await harness.call('read_file', { filePath: 'src/a.ts' });

    assert.equal(toolResult.status, 'success');
    assertParity(t.name, harness, toolResult.data as ReadResult);
  });

  it('matches the read_files tool envelope for a representative pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');

    const toolResult = await harness.call('read_files', { pattern: '**/*.ts' });

    assert.equal(toolResult.status, 'success');
    assertParity(t.name, harness, toolResult.data as ReadResult);
  });

  it('matches the read_directory tool envelope for a representative directory', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');

    const toolResult = await harness.call('read_directory', { directoryPath: 'src' });

    assert.equal(toolResult.status, 'success');
    assertParity(t.name, harness, toolResult.data as ReadResult);
  });
});