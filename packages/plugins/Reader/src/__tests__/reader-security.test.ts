import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readFiles } from '../readEngine.js';
import type { ReadResult } from '../envelope.js';
import {
  bootReaderKernel,
  fixedCandidates,
  instrumentFileSystem,
  toWorkspacePath,
  type ReaderHarness,
} from './reader-test-helpers.js';

function assertViolation(result: { status: string; code?: string } | { status: string; error?: unknown }, rule?: string): void {
  assert.equal(result.status, 'failed');
  assert.equal((result as { code?: string }).code, 'WORKSPACE_PATH_VIOLATION');

  if (rule !== undefined) {
    const data = (result as { data?: { rule?: string } }).data;
    assert.equal(data?.rule, rule);
  }
}

async function expectRejected(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) => (error as { code?: string }).code === code,
  );
}

describe('Goal 7 — security', () => {
  it('rejects a ../ traversal filePath', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(await harness.call('read_file', { filePath: '../../../etc/passwd' }), 'TRAVERSAL');
  });

  it('rejects a nested traversal filePath', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(await harness.call('read_file', { filePath: 'src/../../etc/passwd' }), 'TRAVERSAL');
  });

  it('rejects a Windows-style traversal filePath', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(await harness.call('read_file', { filePath: '..\\..\\etc\\passwd' }), 'TRAVERSAL');
  });

  it('rejects an absolute filePath outside the root', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(await harness.call('read_file', { filePath: '/etc/passwd' }), 'OUTSIDE_ROOT');
  });

  it('rejects a symlink that escapes the root through filePath', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.link('src/escape.txt', '/etc/passwd');

    assertViolation(await harness.call('read_file', { filePath: 'src/escape.txt' }), 'SYMLINK_ESCAPE');
  });

  it('rejects a null byte in filePath', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');

    assertViolation(await harness.call('read_file', { filePath: 'src/a.txt\u0000' }), 'NULL_BYTE');
  });

  it('rejects a .. scope', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(await harness.call('read_files', { pattern: '**/*.ts', scope: '..' }), 'TRAVERSAL');
  });

  it('rejects an absolute scope outside the root', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(
      await harness.call('read_files', { pattern: '**/*.ts', scope: '/etc' }),
      'OUTSIDE_ROOT',
    );
  });

  it('rejects a symlink scope that escapes the root', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.link('escape-dir', '/tmp');

    assertViolation(
      await harness.call('read_files', { pattern: '**/*.ts', scope: 'escape-dir' }),
      'SYMLINK_ESCAPE',
    );
  });

  it('rejects a null byte in scope', async (t) => {
    const harness = await bootReaderKernel(t);

    assertViolation(
      await harness.call('read_files', { pattern: '**/*.ts', scope: 'src\u0000' }),
      'NULL_BYTE',
    );
  });

  it('rejects a .. directoryPath', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(await harness.call('read_directory', { directoryPath: '..' }), 'TRAVERSAL');
  });

  it('rejects an absolute directoryPath outside the root', async (t) => {
    const harness = await bootReaderKernel(t);
    assertViolation(
      await harness.call('read_directory', { directoryPath: '/etc' }),
      'OUTSIDE_ROOT',
    );
  });

  it('rejects a symlink directoryPath that escapes the root', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.link('escape-dir', '/tmp');

    assertViolation(
      await harness.call('read_directory', { directoryPath: 'escape-dir' }),
      'SYMLINK_ESCAPE',
    );
  });

  it('rejects a null byte in directoryPath', async (t) => {
    const harness = await bootReaderKernel(t);

    assertViolation(
      await harness.call('read_directory', { directoryPath: 'src\u0000' }),
      'NULL_BYTE',
    );
  });

  it('does not let a .. exclusion escape the root', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');
    await harness.write('src/sub/b.txt', 'b\n');

    const result = await harness.call('read_directory', {
      directoryPath: 'src',
      recursive: true,
      exclude: '..',
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      (result.data as ReadResult).files.map((file) => file.path).sort(),
      ['src/a.txt', 'src/sub/b.txt'],
    );
  });

  it('does not let a traversal glob exclusion escape the root', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');

    const result = await harness.call('read_directory', {
      directoryPath: 'src',
      recursive: true,
      exclude: '../../*',
    });

    assert.equal(result.status, 'success');
    assert.deepEqual((result.data as ReadResult).files.map((file) => file.path), ['src/a.txt']);
  });

  it('rejects a search candidate outside the root before reading it', async (t) => {
    const harness = await bootReaderKernel(t);
    const probe = instrumentFileSystem(harness.fs);

    await expectRejected(
      readFiles(harness.runtime(fixedCandidates(['/etc/passwd'])), { pattern: '**/*' }),
      'WORKSPACE_PATH_VIOLATION',
    );
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('rejects a search candidate with a traversal path', async (t) => {
    const harness = await bootReaderKernel(t);
    const probe = instrumentFileSystem(harness.fs);

    await expectRejected(
      readFiles(harness.runtime(fixedCandidates(['../../../etc/passwd'])), { pattern: '**/*' }),
      'WORKSPACE_PATH_VIOLATION',
    );
    assert.equal(probe.readCalls, 0);
    probe.restore();
  });

  it('does not follow an import that resolves outside the root', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { p } from '/etc/passwd';\n");
    const probe = instrumentFileSystem(harness.fs);

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(result.files.map((file) => file.path), ['src/a.ts']);
    assert.equal(probe.readPaths.includes('/etc/passwd'), false);
    probe.restore();
  });

  it('does not follow a symlinked import that escapes the root', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { escaped } from './escape.ts';\n");
    await harness.link('src/escape.ts', '/etc/passwd');
    const probe = instrumentFileSystem(harness.fs);

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(result.files.map((file) => file.path), ['src/a.ts']);
    assert.equal(probe.readPaths.some((path) => path.includes('escape.ts')), false);
    probe.restore();
  });

  it('accepts a symlink whose target stays inside the root', async (t) => {
    const harness = await bootReaderKernel(t);
    const target = await harness.write('src/real.txt', 'inside\n');
    await harness.link('src/link.txt', target);

    const result = await harness.call('read_file', { filePath: 'src/link.txt' });

    assert.equal(result.status, 'success');
    assert.equal((result.data as ReadResult).files[0]?.content, 'inside\n');
  });

  it('does not leak content across a concurrent mutation', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'old content\n');
    const probe = instrumentFileSystem(harness.fs);
    probe.delayMs = 30;

    const pending = harness.call('read_file', { filePath: 'src/a.txt' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await harness.fs.writeAtomic('src/a.txt', 'new content\n');
    const result = await pending;

    const content = (result.data as ReadResult).files[0]?.content;
    assert.ok(content === 'old content\n' || content === 'new content\n');
    assert.equal(content, 'new content\n');
    probe.restore();
  });

  it('returns the new content after a completed mutation', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'old\n');
    await harness.fs.writeAtomic('src/a.txt', 'new\n');

    const result = await harness.call('read_file', { filePath: 'src/a.txt' });

    assert.equal((result.data as ReadResult).files[0]?.content, 'new\n');
  });

  it('rejects a raw path alias on read_file', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.txt', 'a\n');

    const result = await harness.call('read_file', {
      filePath: 'src/a.txt',
      path: 'src/a.txt',
    });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u);
  });

  it('rejects a legacy directory alias on read_files', async (t) => {
    const harness = await bootReaderKernel(t);

    const result = await harness.call('read_files', {
      pattern: '**/*.ts',
      directory: 'src',
    });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u);
  });

  it('rejects a raw filePath alias on read_directory', async (t) => {
    const harness = await bootReaderKernel(t);

    const result = await harness.call('read_directory', {
      directoryPath: 'src',
      filePath: 'src/a.txt',
    });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /TOOL_VALIDATION_ERROR/u);
  });

  it('preserves an absolute outside-root path so the filesystem rejects it', () => {
    const outside = '/etc/passwd';

    assert.equal(toWorkspacePath(outside, '/tmp/workspace'), outside);
  });

  it('keeps traversal text intact for the filesystem to reject', () => {
    assert.equal(toWorkspacePath('../../../etc/passwd', '/tmp/workspace'), '../../../etc/passwd');
  });

  it('treats a non-null control-character path as an unreadable skip without escaping', async (t) => {
    const harness = await bootReaderKernel(t);
    const probe = instrumentFileSystem(harness.fs);

    const result = await harness.call('read_file', { filePath: 'src/a.txt\nATTACK' });
    const data = result.data as ReadResult;

    assert.equal(result.status, 'success');
    assert.equal(data.files.length, 0);
    assert.equal(data.skips?.[0]?.reason, 'unreadable');
    assert.equal(probe.readPaths.every((path) => path.startsWith('src/')), true);
    probe.restore();
  });

  it('rejects a null byte in an import specifier without reading outside', async (t) => {
    const harness = await bootReaderKernel(t);
    await harness.write('src/a.ts', "import { bad } from './\u0000bad';\n");
    const probe = instrumentFileSystem(harness.fs);

    const result = await readFile(harness.runtime(), { filePath: 'src/a.ts', isImportRead: true });

    assert.deepEqual(result.files.map((file) => file.path), ['src/a.ts']);
    assert.equal(probe.readPaths.some((path) => path.includes('\u0000')), false);
    probe.restore();
  });

  it('confines every Reader tool to the workspace root', async (t) => {
    const harness = await bootReaderKernel(t);

    assertViolation(await harness.call('read_file', { filePath: join(harness.root, '..', 'outside.txt') }));
    assertViolation(await harness.call('read_files', { pattern: '**/*', scope: join(harness.root, '..') }));
    assertViolation(await harness.call('read_directory', { directoryPath: join(harness.root, '..') }));
  });
});