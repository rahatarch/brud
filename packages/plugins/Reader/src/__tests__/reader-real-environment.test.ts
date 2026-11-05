import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  bootReaderKernel,
  instrumentFileSystem,
  type ReaderHarness,
} from './reader-test-helpers.js';

const SOURCE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));

async function readerSourceFiles(): Promise<string[]> {
  const entries = await readdir(SOURCE_DIRECTORY, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(SOURCE_DIRECTORY, entry.name));
}

async function readAllReaderSource(): Promise<string> {
  const files = await readerSourceFiles();
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));

  return contents.join('\n');
}

function driverName(harness: ReaderHarness): string {
  const service = harness.fs as unknown as { driver?: { constructor?: { name?: string } } };

  return service.driver?.constructor?.name ?? 'unknown';
}

describe('Goal 2 — real-environment reads', () => {
  it('boots the standard kernel over a real temporary directory', async (t) => {
    const harness = await bootReaderKernel(t);

    assert.ok(harness.root.startsWith('/'));
    assert.equal(harness.kernel.lifecycleState, 'RUNNING');
    assert.equal(harness.fs.constructor.name, 'BrudFileSystem');
  });

  it('uses the durable node driver, not an in-memory driver', async (t) => {
    const harness = await bootReaderKernel(t);

    assert.equal(driverName(harness), 'DurableNodeStorageDriver');
  });

  it('does not import node:fs anywhere in Reader source', async () => {
    const source = await readAllReaderSource();

    assert.equal(/from\s+['"]node:fs(?:\/promises)?['"]/u.test(source), false);
    assert.equal(/require\(\s*['"]node:fs(?:\/promises)?['"]\s*\)/u.test(source), false);
    assert.equal(/from\s+['"]fs['"]/u.test(source), false);
  });

  it('does not mention the in-memory storage driver in Reader source', async () => {
    const source = await readAllReaderSource();
    const forbidden = ['InMemory', 'StorageDriver'].join('');

    assert.equal(source.includes(forbidden), false);
  });

  it('reads a real file written to the temporary directory', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/hello.txt', 'hello real world\n');

    const result = await harness.call('read_file', { filePath: 'src/hello.txt' });

    assert.equal(result.status, 'success');
    const data = result.data as { files: Array<{ content?: string; path: string }> };
    assert.equal(data.files.length, 1);
    assert.equal(data.files[0]?.path, 'src/hello.txt');
    assert.equal(data.files[0]?.content, 'hello real world\n');
  });

  it('reads through context.getFileSystem() as observed on the real service', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/observed.txt', 'observed\n');
    const probe = instrumentFileSystem(harness.fs);

    const result = await harness.call('read_file', { filePath: 'src/observed.txt' });

    assert.equal(result.status, 'success');
    assert.ok(probe.readCalls > 0, 'expected at least one real filesystem read');
    assert.ok(probe.readPaths.includes('src/observed.txt'));
    probe.restore();
  });

  it('reads a file created through the kernel filesystem service', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.fs.createFile('src/created.txt', 'created through the service\n');

    const result = await harness.call('read_file', { filePath: 'src/created.txt' });

    assert.equal(result.status, 'success');
    assert.equal(
      (result.data as { files: Array<{ content?: string }> }).files[0]?.content,
      'created through the service\n',
    );
  });

  it('returns isBinary true and no content for a binary file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('assets/image.bin', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

    const result = await harness.call('read_file', { filePath: 'assets/image.bin' });
    const data = result.data as {
      files: Array<{ isBinary?: boolean; content?: string; size: number }>;
      skips: Array<{ reason: string }>;
    };

    assert.equal(result.status, 'success');
    assert.equal(data.files[0]?.isBinary, true);
    assert.equal(data.files[0]?.content, undefined);
    assert.equal(data.files[0]?.size, 6);
    assert.deepEqual(data.skips.map((skip) => skip.reason), ['binary']);
  });

  it('reads UTF-8 text byte-for-byte', async (t) => {
    const harness = await bootReaderKernel(t);
    const content = 'café — 日本語 — 🚀\nsecond line\n';
    await harness.write('src/unicode.txt', content);

    const result = await harness.call('read_file', { filePath: 'src/unicode.txt' });
    const data = result.data as { files: Array<{ content?: string; totalLines: number }> };

    assert.equal(result.status, 'success');
    assert.equal(data.files[0]?.content, content);
    assert.equal(data.files[0]?.totalLines, 2);
  });

  it('reads a nested file with a real directory traversal', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('a/b/c/deep.txt', 'deep\n');

    const result = await harness.call('read_files', { pattern: '**/deep.txt' });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      (result.data as { files: Array<{ path: string }> }).files.map((file) => file.path),
      ['a/b/c/deep.txt'],
    );
  });

  it('reads a real directory listing', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');
    await harness.write('src/b.txt', 'b\n');
    await harness.write('src/sub/c.txt', 'c\n');

    const result = await harness.call('read_directory', { directoryPath: 'src' });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      (result.data as { files: Array<{ path: string }> }).files.map((file) => file.path).sort(),
      ['src/a.txt', 'src/b.txt'],
    );
  });

  it('returns an unreadable skip for a missing real file', async (t) => {
    const harness = await bootReaderKernel(t);

    const result = await harness.call('read_file', { filePath: 'src/does-not-exist.txt' });
    const data = result.data as {
      files: unknown[];
      skips: Array<{ path: string; reason: string }>;
    };

    assert.equal(result.status, 'success');
    assert.equal(data.files.length, 0);
    assert.equal(data.skips[0]?.path, 'src/does-not-exist.txt');
    assert.equal(data.skips[0]?.reason, 'unreadable');
  });

  it('follows a real import through the kernel utility service', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await harness.write('src/b.ts', 'export const b = 1;\n');

    const result = await harness.call('read_file', { filePath: 'src/a.ts', isImportRead: true });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      (result.data as { files: Array<{ path: string; isImported?: boolean }> }).files
        .map((file) => ({ path: file.path, isImported: file.isImported })),
      [
        { path: 'src/a.ts', isImported: undefined },
        { path: 'src/b.ts', isImported: true },
      ],
    );
  });

  it('resolves read_files candidates through the real search_files tool', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', 'a\n');
    await harness.write('src/b.ts', 'b\n');
    const probe = instrumentFileSystem(harness.fs);

    const result = await harness.call('read_files', { pattern: '**/*.ts' });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      (result.data as { files: Array<{ path: string }> }).files.map((file) => file.path).sort(),
      ['src/a.ts', 'src/b.ts'],
    );
    assert.ok(probe.readCalls >= 2);
    probe.restore();
  });

  it('reports the same bytes that exist on the real host file', async (t) => {
    const harness = await bootReaderKernel(t);
    const absolute = await harness.write('src/bytes.txt', 'abcdef\n');

    const result = await harness.call('read_file', { filePath: 'src/bytes.txt' });
    const host = await readFile(absolute, 'utf8');

    assert.equal((result.data as { files: Array<{ content?: string }> }).files[0]?.content, host);
  });
});