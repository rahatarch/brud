import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readDirectory, readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  bootReaderKernel,
  withTimeout,
  type ReaderHarness,
} from './reader-test-helpers.js';

function prototypeSnapshot(): string[] {
  return Object.getOwnPropertyNames(Object.prototype).sort();
}

async function deepTree(harness: ReaderHarness, levels: number): Promise<string> {
  const parts: string[] = [];

  for (let index = 0; index < levels; index += 1) {
    parts.push(`d${index}`);
  }

  const directory = `deep/${parts.join('/')}`;
  await harness.write(`${directory}/leaf.txt`, 'leaf\n');

  return `${directory}/leaf.txt`;
}

describe('Goal 8 — adversarial', () => {
  it('does not hang on a nested glob', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/nested/b.ts', 'b\n');

    const result = await withTimeout(
      readFiles(harness.runtime(), { pattern: '**/**/**/**/*' }),
      2000,
      'nested glob',
    );

    assert.equal(result.totalFiles >= 0, true);
  });

  it('does not hang on a very long literal pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const pattern = 'a'.repeat(10_000);

    const result = await withTimeout(
      readFiles(harness.runtime(), { pattern }),
      2000,
      'long literal pattern',
    );

    assert.equal(result.totalFiles, 0);
  });

  it('does not hang on a deeply nested brace glob', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await withTimeout(
      readFiles(harness.runtime(), { pattern: 'src/{a,{b,{c,{d,e}}}}.ts' }),
      2000,
      'brace glob',
    );

    assert.deepEqual(result.files.map((file) => file.path), ['src/a.ts']);
  });

  it('handles an unmatched opening bracket glob', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await readFiles(harness.runtime(), { pattern: 'src/[a.ts' });

    assert.equal(result.totalFiles, 0);
  });

  it('handles an unmatched opening brace glob', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await readFiles(harness.runtime(), { pattern: 'src/{a.ts' });

    assert.equal(result.totalFiles, 0);
  });

  it('does not pollute Object.prototype through a __proto__ pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const before = prototypeSnapshot();

    const result = await readFiles(harness.runtime(), { pattern: '__proto__' });

    assert.equal(result.totalFiles, 0);
    assert.deepEqual(prototypeSnapshot(), before);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('does not pollute Object.prototype through a constructor pattern', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const before = prototypeSnapshot();

    const result = await readFiles(harness.runtime(), { pattern: 'constructor' });

    assert.equal(result.totalFiles, 0);
    assert.deepEqual(prototypeSnapshot(), before);
  });

  it('does not pollute Object.prototype through an exclusion', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const before = prototypeSnapshot();

    const result = await readDirectory(harness.runtime(), {
      directoryPath: 'src',
      exclude: '__proto__',
    });

    assert.equal(result.totalFiles, 1);
    assert.deepEqual(prototypeSnapshot(), before);
  });

  it('does not pollute Object.prototype through a __proto__ payload key', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    const before = prototypeSnapshot();
    const payload = JSON.parse('{"filePath":"src/a.ts","__proto__":{"polluted":true}}') as Record<string, unknown>;

    const result = await harness.call('read_file', payload);

    assert.equal(result.status, 'failed');
    assert.deepEqual(prototypeSnapshot(), before);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('rejects a malformed importSyntax opening bracket', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import './b';\n");
    await harness.write('src/b.ts', 'export const b = true;\n');

    const result = await harness.call('read_file', {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: '[',
    });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'INVALID_FIELD');
  });

  it('rejects a malformed importSyntax opening parenthesis', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import './b';\n");

    const result = await harness.call('read_file', {
      filePath: 'src/a.ts',
      isImportRead: true,
      importSyntax: '(',
    });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'INVALID_FIELD');
  });

  it('preserves a UTF-8 BOM', async (t) => {
    const harness = await bootReaderKernel(t);
    const content = '\uFEFFfirst line\nsecond line\n';
    await harness.write('src/bom.txt', content);

    const result = await readFile(harness.runtime(), { filePath: 'src/bom.txt' });

    assert.equal(result.files[0]?.content, content);
    assert.equal(result.files[0]?.content?.charCodeAt(0), 0xFEFF);
  });

  it('preserves surrogate pairs', async (t) => {
    const harness = await bootReaderKernel(t);
    const content = 'emoji 🚀🧪 and 𠮷\n';
    await harness.write('src/surrogate.txt', content);

    const result = await readFile(harness.runtime(), { filePath: 'src/surrogate.txt' });

    assert.equal(result.files[0]?.content, content);
    assert.equal([...content].some((character) => (character.codePointAt(0) ?? 0) > 0xFFFF), true);
  });

  it('preserves combining marks', async (t) => {
    const harness = await bootReaderKernel(t);
    const content = 'cafe\u0301 nai\u0308ve\n';
    await harness.write('src/combining.txt', content);

    const result = await readFile(harness.runtime(), { filePath: 'src/combining.txt' });

    assert.equal(result.files[0]?.content, content);
    assert.equal(result.files[0]?.content?.includes('\u0301'), true);
  });

  it('treats a null byte in content as binary', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/null.bin', Buffer.from('abc\u0000def', 'utf8'));

    const result = await readFile(harness.runtime(), { filePath: 'src/null.bin' });

    assert.equal(result.files[0]?.isBinary, true);
    assert.equal(result.files[0]?.content, undefined);
    assert.deepEqual(result.skips, [{ path: 'src/null.bin', reason: 'binary' }]);
  });

  it('rejects a 100KB filePath before reading content', async (t) => {
    const harness = await bootReaderKernel(t);
    const oversized = `src/${'a'.repeat(100_000)}`;

    const result = await harness.call('read_file', { filePath: oversized });

    assert.equal(result.status, 'failed');
    assert.equal((result as { code?: string }).code, 'WORKSPACE_PATH_VIOLATION');
    assert.equal((result.data as { files?: unknown[] } | undefined)?.files, undefined);
  });

  it('does not hang on a 100KB glob', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await withTimeout(
      readFiles(harness.runtime(), { pattern: `${'a'.repeat(100_000)}` }),
      2000,
      'oversized glob',
    );

    assert.equal(result.totalFiles, 0);
  });

  it('runs two concurrent read_file calls without state corruption', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'alpha\n');
    await harness.write('src/b.txt', 'beta\n');

    const [first, second] = await Promise.all([
      harness.call('read_file', { filePath: 'src/a.txt' }),
      harness.call('read_file', { filePath: 'src/b.txt' }),
    ]);

    assert.equal((first.data as ReadResult).files[0]?.content, 'alpha\n');
    assert.equal((second.data as ReadResult).files[0]?.content, 'beta\n');
    assert.equal((first.data as ReadResult).files[0]?.path, 'src/a.txt');
    assert.equal((second.data as ReadResult).files[0]?.path, 'src/b.txt');
  });

  it('runs 20 concurrent reads without state corruption', async (t) => {
    const harness = await bootReaderKernel(t);
    const expected = new Map<string, string>();

    for (let index = 0; index < 20; index += 1) {
      const path = `src/f${index}.txt`;
      const content = `content-${index}\n`;
      expected.set(path, content);
      await harness.write(path, content);
    }

    const results = await Promise.all(
      [...expected.keys()].map((path) => harness.call('read_file', { filePath: path })),
    );

    results.forEach((result, index) => {
      const path = `src/f${index}.txt`;
      assert.equal((result.data as ReadResult).files[0]?.content, expected.get(path));
      assert.equal((result.data as ReadResult).files[0]?.path, path);
    });
  });

  it('reads a roughly 1,000-character path', async (t) => {
    const harness = await bootReaderKernel(t);
    const segments = Array.from({ length: 5 }, (_value, index) => `${index}${'a'.repeat(188)}`);
    const relative = `long/${segments.join('/')}/leaf.txt`;
    await harness.write(relative, 'long path\n');
    assert.ok(relative.length >= 950);

    const result = await readFile(harness.runtime(), { filePath: relative });

    assert.equal(result.files[0]?.content, 'long path\n');
  });

  it('reads a file 50 directories deep', async (t) => {
    const harness = await bootReaderKernel(t);
    const relative = await deepTree(harness, 50);

    const result = await readFile(harness.runtime(), { filePath: relative });

    assert.equal(result.files[0]?.content, 'leaf\n');
  });

  it('walks a 50-level directory tree without a stack overflow', async (t) => {
    const harness = await bootReaderKernel(t);
    await deepTree(harness, 50);

    const result = await readDirectory(harness.runtime(), {
      directoryPath: 'deep',
      recursive: true,
    });

    assert.equal(result.totalFiles, 1);
    assert.ok(result.files[0]?.path.endsWith('/leaf.txt'));
  });

  it('handles a glob containing a null byte without crashing', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');

    const result = await withTimeout(
      readFiles(harness.runtime(), { pattern: 'a\u0000b' }),
      2000,
      'null-byte glob',
    );

    assert.equal(result.totalFiles, 0);
  });

  it('handles a character-class glob at its edges', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');

    const result = await readFiles(harness.runtime(), { pattern: 'src/[ab].ts' });

    assert.deepEqual(result.files.map((file) => file.path).sort(), ['src/a.ts', 'src/b.ts']);
  });
});