import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DirectoryEntry, FileStats } from '../../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { ReadOnlyFacade, ReadOnlyViolationError } from './ReadOnlyFacade.js';

class RecordingFileSystem implements IBrudFileSystem {
  readonly calls: string[] = [];

  async readFile(relativePath: string): Promise<Uint8Array> {
    this.calls.push(`readFile:${relativePath}`);
    return Uint8Array.from([1, 2, 3]);
  }

  async readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    this.calls.push(`readText:${relativePath}:${encoding ?? 'utf8'}`);
    return 'payload';
  }

  async writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    this.calls.push(`writeAtomic:${relativePath}:${String(data)}`);
  }

  async createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    this.calls.push(`createFile:${relativePath}:${String(data)}:${String(options?.overwrite)}`);
  }

  async deleteFile(relativePath: string): Promise<void> {
    this.calls.push(`deleteFile:${relativePath}`);
  }

  async readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    this.calls.push(`readDirectory:${relativeDirectoryPath}`);
    return [{ name: 'child.txt', isFile: true, isDirectory: false }];
  }

  async stat(relativePath: string): Promise<FileStats | null> {
    this.calls.push(`stat:${relativePath}`);
    return { size: 7, mtimeMs: 1, isFile: true, isDirectory: false };
  }

  async exists(relativePath: string): Promise<boolean> {
    this.calls.push(`exists:${relativePath}`);
    return true;
  }
}

function isReadOnlyViolation(error: unknown): boolean {
  return error instanceof ReadOnlyViolationError && error.code === 'READ_ONLY_VIOLATION';
}

describe('ReadOnlyFacade', () => {
  it('delegates every read operation to the wrapped service', async () => {
    const inner = new RecordingFileSystem();
    const facade = new ReadOnlyFacade(inner);

    assert.deepEqual(Array.from(await facade.readFile('a.txt')), [1, 2, 3]);
    assert.equal(await facade.readText('a.txt'), 'payload');
    assert.equal(await facade.readText('a.txt', 'base64'), 'payload');
    assert.deepEqual(await facade.readDirectory('directory'), [
      { name: 'child.txt', isFile: true, isDirectory: false },
    ]);
    assert.deepEqual(await facade.stat('a.txt'), {
      size: 7,
      mtimeMs: 1,
      isFile: true,
      isDirectory: false,
    });
    assert.equal(await facade.exists('a.txt'), true);

    assert.deepEqual(inner.calls, [
      'readFile:a.txt',
      'readText:a.txt:utf8',
      'readText:a.txt:base64',
      'readDirectory:directory',
      'stat:a.txt',
      'exists:a.txt',
    ]);
  });

  it('rejects every mutation without touching the wrapped service', async () => {
    const inner = new RecordingFileSystem();
    const facade = new ReadOnlyFacade(inner);

    await assert.rejects(facade.writeAtomic('a.txt', 'data'), isReadOnlyViolation);
    await assert.rejects(
      facade.createFile('a.txt', 'data', { overwrite: true }),
      isReadOnlyViolation,
    );
    await assert.rejects(facade.deleteFile('a.txt'), isReadOnlyViolation);

    assert.deepEqual(inner.calls, []);
  });
});
