import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFiles } from './index.js';
import type { FileSystem } from '../types/filesystem.js';
import type { BrudSettings } from '../settings/types.js';

interface MemoryFsOptions {
  withStat?: boolean;
  withReadBytes?: boolean;
  delay?: (filePath: string) => number;
  failPaths?: string[];
}

interface MemoryFs extends FileSystem {
  reads: string[];
  maxActiveReads: number;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createMemoryFs(files: Map<string, Uint8Array>, options: MemoryFsOptions = {}): MemoryFs {
  const reads: string[] = [];
  const failPaths = new Set(options.failPaths ?? []);
  let activeReads = 0;
  let maxActiveReads = 0;

  async function readBytes(filePath: string): Promise<Uint8Array> {
    reads.push(filePath);
    activeReads++;
    maxActiveReads = Math.max(maxActiveReads, activeReads);
    try {
      const delay = options.delay?.(filePath) ?? 0;
      if (delay > 0) {
        await wait(delay);
      }
      if (failPaths.has(filePath)) {
        throw new Error(`EACCES: permission denied, open '${filePath}'`);
      }
      const bytes = files.get(filePath);
      if (!bytes) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }
      return bytes;
    } finally {
      activeReads--;
    }
  }

  const fs: MemoryFs = {
    reads,
    get maxActiveReads() {
      return maxActiveReads;
    },
    async readFile(filePath: string): Promise<string> {
      const bytes = await readBytes(filePath);
      return Buffer.from(bytes).toString('utf8');
    },
    async readFileBytes(filePath: string): Promise<Uint8Array> {
      return readBytes(filePath);
    },
    async writeFile(): Promise<void> {
      throw new Error('not implemented');
    },
    async deleteFile(): Promise<void> {
      throw new Error('not implemented');
    },
    async renameFile(): Promise<void> {
      throw new Error('not implemented');
    },
    async copyFile(): Promise<void> {
      throw new Error('not implemented');
    },
    async exists(filePath: string): Promise<boolean> {
      return files.has(filePath);
    },
    async createDirectory(): Promise<void> {
      throw new Error('not implemented');
    },
    async deleteDirectoryRecursive(): Promise<void> {
      throw new Error('not implemented');
    },
    async moveDirectory(): Promise<void> {
      throw new Error('not implemented');
    },
    async listDirectory(): Promise<string[]> {
      return [];
    },
    async listDirectoryContents(): Promise<{ name: string; isDirectory: boolean }[]> {
      return [];
    },
  };

  if (options.withStat) {
    fs.stat = async (filePath: string) => {
      const bytes = files.get(filePath);
      if (!bytes) {
        throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
      }
      return { size: bytes.byteLength, isDirectory: false };
    };
  }

  if (options.withReadBytes === false) {
    delete fs.readFileBytes;
  }

  return fs;
}

function buildTextFiles(count: number, size = 16): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const body = `${'a'.repeat(Math.max(1, size - 1))}`;
    files.set(`/virtual/file-${String(i).padStart(3, '0')}.txt`, new Uint8Array(Buffer.from(body)));
  }
  return files;
}

describe('readFiles governor', () => {
  it('rejects a direct batch above the file limit before any read', async () => {
    const filePaths = Array.from({ length: 101 }, (_, i) => `/virtual/overflow-${i}.txt`);
    const fs = createMemoryFs(new Map());

    await assert.rejects(
      () => readFiles(fs, filePaths, false, 0, undefined, undefined, undefined, undefined, {
        settings: { readMaxBatchFiles: 500 } as BrudSettings,
      }),
      (err: unknown) => (err as { code?: string }).code === 'BATCH_LIMIT_EXCEEDED',
    );

    assert.strictEqual(fs.reads.length, 0);
  });

  it('preserves original input order regardless of completion order', async () => {
    const filePaths = Array.from({ length: 12 }, (_, i) => `/virtual/order-${i}.txt`);
    const files = new Map<string, Uint8Array>(
      filePaths.map((filePath, i) => [filePath, new Uint8Array(Buffer.from(`content-${i}`))]),
    );
    const delays = [45, 5, 30, 10, 50, 1, 25, 15, 40, 20, 35, 8];
    const fs = createMemoryFs(files, {
      delay: (filePath) => delays[filePaths.indexOf(filePath)] ?? 0,
    });

    const result = await readFiles(fs, filePaths, false, 0, undefined, undefined, undefined, undefined, {
      settings: { readConcurrency: 4 } as BrudSettings,
    });

    assert.deepStrictEqual(result.files.map(entry => entry.path), filePaths);
    assert.strictEqual(result.totalFiles, 12);
  });

  it('never exceeds the configured concurrency lane limit', async () => {
    const filePaths = Array.from({ length: 14 }, (_, i) => `/virtual/lanes-${i}.txt`);
    const files = new Map<string, Uint8Array>(
      filePaths.map((filePath, i) => [filePath, new Uint8Array(Buffer.from(`lane-${i}`))]),
    );
    const fs = createMemoryFs(files, { delay: () => 20 });

    await readFiles(fs, filePaths, false, 0, undefined, undefined, undefined, undefined, {
      settings: { readConcurrency: 3 } as BrudSettings,
    });

    assert.ok(fs.maxActiveReads <= 3, `expected at most 3 active reads, saw ${fs.maxActiveReads}`);
    assert.ok(fs.maxActiveReads > 1, 'expected the pool to run more than one lane');
  });

  it('flags binary files without text content and records a skip entry', async () => {
    const filePath = '/virtual/image.bin';
    const files = new Map<string, Uint8Array>([
      [filePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02])],
    ]);
    const fs = createMemoryFs(files, { withStat: true });

    const result = await readFiles(fs, [filePath], false, 0);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].isBinary, true);
    assert.strictEqual(result.files[0].content, undefined);
    assert.deepStrictEqual(result.skips, [{ path: filePath, reason: 'binary' }]);
  });

  it('truncates the admitted set when the aggregate byte budget is exceeded', async () => {
    const filePaths = ['/virtual/budget-a.txt', '/virtual/budget-b.txt', '/virtual/budget-c.txt'];
    const files = new Map<string, Uint8Array>(
      filePaths.map(filePath => [filePath, new Uint8Array(Buffer.from('abcd'))]),
    );
    const fs = createMemoryFs(files, { withStat: true });

    const result = await readFiles(fs, filePaths, false, 0, undefined, undefined, undefined, undefined, {
      settings: { readMaxAggregateBytes: 5 } as BrudSettings,
    });

    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.limitHit, 'bytes');
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.totalSize, 4);
    assert.strictEqual(fs.reads.length, 1);
  });

  it('clamps the result deterministically when stat is unavailable', async () => {
    const filePaths = ['/virtual/nostat-a.txt', '/virtual/nostat-b.txt', '/virtual/nostat-c.txt'];
    const files = new Map<string, Uint8Array>(
      filePaths.map(filePath => [filePath, new Uint8Array(Buffer.from('abcd'))]),
    );
    const fs = createMemoryFs(files, { withStat: false });

    const result = await readFiles(fs, filePaths, false, 0, undefined, undefined, undefined, undefined, {
      settings: { readMaxAggregateBytes: 6 } as BrudSettings,
    });

    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.limitHit, 'bytes');
    assert.deepStrictEqual(result.files.map(entry => entry.path), filePaths.slice(0, 1));
    assert.strictEqual(result.totalSize, 4);
  });

  it('records unreadable files in the skip list instead of dropping them', async () => {
    const readable = '/virtual/readable.txt';
    const unreadable = '/virtual/unreadable.txt';
    const files = new Map<string, Uint8Array>([
      [readable, new Uint8Array(Buffer.from('visible text'))],
    ]);
    const fs = createMemoryFs(files, { withStat: true, failPaths: [unreadable] });

    const result = await readFiles(fs, [readable, unreadable], false, 0);

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].path, readable);
    const unreadableSkip = result.skips?.find(skip => skip.path === unreadable);
    assert.ok(unreadableSkip, 'expected an unreadable skip entry');
    assert.strictEqual(unreadableSkip.reason, 'unreadable');
    assert.ok(unreadableSkip.error?.includes('EACCES'));
  });
});
