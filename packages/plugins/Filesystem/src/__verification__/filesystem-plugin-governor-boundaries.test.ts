/**
 * Goal 3 — Governor enforcement at exact boundaries.
 *
 * Batch (100), depth (32), byte (16 MiB), and concurrency (8) are probed at
 * N-1 / N / N+1. Multi-file probes use a deterministic search stand-in so the
 * candidate count is exact; the mutations themselves are real files.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  DirectoryEntry, FileStats } from '@brud/kernel';
import { DurableNodeStorageDriver } from '../../../../services/BrudFileSystem/drivers/DurableNodeStorageDriver.js';
import {
  MAX_BYTES_PER_MUTATION,
  MAX_CONCURRENCY,
  MAX_DIRECTORY_DEPTH,
  MAX_FILES_PER_MUTATION,
  checkBatch,
  checkBytes,
  checkDepth,
  runWithConcurrency,
} from '../governor/index.js';
import { appendFile } from '../groups/file/appendFile/index.js';
import { createFile } from '../groups/file/createFile/index.js';
import { deleteDirectory } from '../groups/directory/deleteDirectory/index.js';
import { appendFileMulti } from '../groups/multi/appendFileMulti/index.js';
import { searchReplaceMulti } from '../groups/multi/searchReplaceMulti/index.js';
import {
  absolute,
  acquireVerificationLock,
  bootVerificationKernel,
  createRuntime,
  errorCode,
  fakeSearch,
  makeDeepDirectory,
  readReal,
  realExists,
  realSize,
  releaseVerificationLock,
  sleep,
  writeReal,
} from './support/harness.test.js';
import type { VerificationKernel } from './support/harness.test.js';

const MIB = 1024 * 1024;
const BYTE_CAP = 16 * MIB;

class CountingDriver extends DurableNodeStorageDriver {
  public active = 0;

  public peak = 0;

  public reset(): void {
    this.active = 0;
    this.peak = 0;
  }

  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    // Small delay makes overlap observable without changing semantics.
    await sleep(1);

    try {
      return await work();
    } finally {
      this.active -= 1;
    }
  }

  override async readFile(path: string): Promise<Uint8Array> {
    return this.track(() => super.readFile(path));
  }

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return this.track(() => super.writeFile(path, data));
  }

  override async writeFileExclusive(
    path: string,
    data: Uint8Array | string,
    options?: { readonly mode?: number },
  ): Promise<void> {
    return this.track(() => super.writeFileExclusive(path, data, options));
  }

  override async rename(source: string, target: string): Promise<void> {
    return this.track(() => super.rename(source, target));
  }

  override async copy(source: string, target: string): Promise<void> {
    return this.track(() => super.copy(source, target));
  }

  override async deleteFile(path: string): Promise<void> {
    return this.track(() => super.deleteFile(path));
  }

  override async deleteDirectory(path: string): Promise<void> {
    return this.track(() => super.deleteDirectory(path));
  }

  override async mkdir(
    path: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void> {
    return this.track(() => super.mkdir(path, options));
  }

  override async stat(path: string): Promise<FileStats | null> {
    return this.track(() => super.stat(path));
  }

  override async readDir(path: string): Promise<readonly DirectoryEntry[]> {
    return this.track(() => super.readDir(path));
  }

  override async realpath(path: string): Promise<string> {
    return this.track(() => super.realpath(path));
  }
}

let kernel: VerificationKernel;

before(async () => {
  await acquireVerificationLock();
  kernel = await bootVerificationKernel({
    prefix: 'brud-fs-verify-governor-',
    withoutMutationRecording: true,
  });
});

after(async () => {
  await kernel.shutdown();
  await releaseVerificationLock();
});

async function seedFiles(
  count: number,
  prefix: string,
  content = 'base',
): Promise<string[]> {
  const paths: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const path = `${prefix}/${String(index).padStart(3, '0')}.txt`;
    await writeReal(kernel.root, path, content);
    paths.push(path);
  }

  return paths;
}

async function assertAllContent(paths: readonly string[], expected: string): Promise<void> {
  for (const path of paths) {
    assert.equal(await readReal(kernel.root, path), expected, `${path} content`);
  }
}

/** Builds a path with exactly `depth` segments, the last being a file name. */
function pathOfDepth(depth: number, fileName: string): string {
  const directories = Array.from(
    { length: depth - 1 },
    (_, index) => `p${index + 1}`,
  );

  return [...directories, fileName].join('/');
}

describe('Goal 3 — governor pure boundaries', () => {
  it('admits 100 files and refuses 101', () => {
    assert.equal(MAX_FILES_PER_MUTATION, 100);
    assert.equal(checkBatch(Array.from({ length: 99 }, (_, i) => String(i))).ok, true);
    assert.equal(checkBatch(Array.from({ length: 100 }, (_, i) => String(i))).ok, true);

    const refused = checkBatch(Array.from({ length: 101 }, (_, i) => String(i)));

    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'BATCH_LIMIT_EXCEEDED');
  });

  it('admits depth 32 and refuses depth 33', () => {
    assert.equal(MAX_DIRECTORY_DEPTH, 32);
    assert.equal(checkDepth(pathOfDepth(32, 'f.txt')).ok, true);

    const refused = checkDepth(pathOfDepth(33, 'f.txt'));

    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'DEPTH_LIMIT_EXCEEDED');
  });

  it('admits 16 MiB and refuses 16 MiB + 1 byte', () => {
    assert.equal(MAX_BYTES_PER_MUTATION, BYTE_CAP);
    assert.equal(checkBytes(BYTE_CAP).ok, true);

    const refused = checkBytes(BYTE_CAP + 1);

    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'BYTE_LIMIT_EXCEEDED');
  });

  it('clamps a large concurrency request to 8', async () => {
    let active = 0;
    let peak = 0;

    await runWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      100,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(5);
        active -= 1;
      },
    );

    assert.equal(MAX_CONCURRENCY, 8);
    assert.ok(peak <= 8, `peak concurrency ${peak} must be <= 8`);
    assert.equal(peak, 8, 'the worker pool should saturate the cap');
  });

  it('preserves input order under bounded concurrency', async () => {
    const results = await runWithConcurrency(
      [5, 1, 3, 2, 4, 0],
      2,
      async (item) => {
        await sleep(item * 2);
        return item * 10;
      },
    );

    assert.deepEqual(results, [50, 10, 30, 20, 40, 0]);
  });
});

describe('Goal 3 — batch boundary through the plugin', () => {
  for (const count of [99, 100]) {
    it(`append_file_multi admits ${count} candidates`, async () => {
      const paths = await seedFiles(count, `batch-append-${count}`, 'base');
      const runtime = createRuntime(kernel, fakeSearch(paths));
      const result = await appendFileMulti(
        { pattern: '**/*.txt', content: 'X' },
        runtime,
      );

      assert.equal(result.status, 'success');
      const data = result.data as { files: unknown[] };
      assert.equal(data.files.length, count);
      await assertAllContent(paths.slice(0, 3), 'base\n\nX');
    });
  }

  it('append_file_multi refuses 101 candidates', async () => {
    const paths = await seedFiles(101, 'batch-append-101', 'base');
    const runtime = createRuntime(kernel, fakeSearch(paths));
    const result = await appendFileMulti(
      { pattern: '**/*.txt', content: 'X' },
      runtime,
    );

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
  });

  it('append_file_multi 101 mutates no file', async () => {
    const paths = await seedFiles(101, 'batch-append-101-clean', 'base');
    const runtime = createRuntime(kernel, fakeSearch(paths));

    await appendFileMulti({ pattern: '**/*.txt', content: 'X' }, runtime);
    await assertAllContent(paths, 'base');
  });

  it('search_replace_multi admits 100 candidates', async () => {
    const paths = await seedFiles(100, 'batch-replace-100', 'needle');
    const runtime = createRuntime(kernel, fakeSearch(paths));
    const result = await searchReplaceMulti(
      { pattern: '**/*.txt', search: 'needle', replace: 'done' },
      runtime,
    );

    assert.equal(result.status, 'success');
    await assertAllContent(paths.slice(0, 3), 'done');
  });

  it('search_replace_multi refuses 101 candidates', async () => {
    const paths = await seedFiles(101, 'batch-replace-101', 'needle');
    const runtime = createRuntime(kernel, fakeSearch(paths));
    const result = await searchReplaceMulti(
      { pattern: '**/*.txt', search: 'needle', replace: 'done' },
      runtime,
    );

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
  });

  it('search_replace_multi 101 mutates no file', async () => {
    const paths = await seedFiles(101, 'batch-replace-101-clean', 'needle');
    const runtime = createRuntime(kernel, fakeSearch(paths));

    await searchReplaceMulti(
      { pattern: '**/*.txt', search: 'needle', replace: 'done' },
      runtime,
    );
    await assertAllContent(paths, 'needle');
  });
});

describe('Goal 3 — depth boundary through the plugin', () => {
  it('delete_directory refuses a 33-deep tree', async () => {
    const directory = await makeDeepDirectory(kernel.root, 33, undefined, 'a');
    const result = await deleteDirectory({ directoryPath: directory }, createRuntime(kernel));

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'VALIDATION_ERROR');
    assert.match(
      JSON.stringify(result.data),
      /depth|Depth/u,
      'the failure must name the depth limit',
    );
    assert.equal(await realExists(kernel.root, directory), true);
  });

  it('delete_directory admits a 32-deep tree', async () => {
    const directory = await makeDeepDirectory(kernel.root, 32, undefined, 'b');
    const result = await deleteDirectory({ directoryPath: directory }, createRuntime(kernel));

    assert.equal(result.status, 'success');
    assert.equal(await realExists(kernel.root, directory), false);
  });

  it('create_file refuses a 33-segment target', async () => {
    const path = pathOfDepth(33, 'deep.txt');
    const result = await createFile({ path, content: 'x' }, createRuntime(kernel));

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'VALIDATION_ERROR');
    assert.equal(await realExists(kernel.root, path), false);
  });

  it('create_file admits a 32-segment target', async () => {
    const path = pathOfDepth(32, 'deep-ok.txt');
    const result = await createFile({ path, content: 'x' }, createRuntime(kernel));

    assert.equal(result.status, 'success');
    assert.equal(await readReal(kernel.root, path), 'x');
  });
});

describe('Goal 3 — byte boundary through the plugin', () => {
  it('create_file admits 16 MiB - 1 byte', async () => {
    const content = 'a'.repeat(BYTE_CAP - 1);
    const result = await createFile(
      { path: 'bytes/create-minus-one.txt', content },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await realSize(kernel.root, 'bytes/create-minus-one.txt'), BYTE_CAP - 1);
  });

  it('create_file admits exactly 16 MiB', async () => {
    const content = 'b'.repeat(BYTE_CAP);
    const result = await createFile(
      { path: 'bytes/create-exact.txt', content },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
    assert.equal(await realSize(kernel.root, 'bytes/create-exact.txt'), BYTE_CAP);
  });

  it('create_file refuses 16 MiB + 1 byte and writes nothing', async () => {
    const content = 'c'.repeat(BYTE_CAP + 1);
    const result = await createFile(
      { path: 'bytes/create-over.txt', content },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
    assert.equal(await realExists(kernel.root, 'bytes/create-over.txt'), false);
  });

  it('append_file admits 16 MiB - 1 byte', async () => {
    await writeReal(kernel.root, 'bytes/append-minus-one.txt', 'seed');
    const result = await appendFile(
      { path: 'bytes/append-minus-one.txt', content: 'd'.repeat(BYTE_CAP - 1) },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
  });

  it('append_file admits exactly 16 MiB', async () => {
    await writeReal(kernel.root, 'bytes/append-exact.txt', 'seed');
    const result = await appendFile(
      { path: 'bytes/append-exact.txt', content: 'e'.repeat(BYTE_CAP) },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'success');
  });

  it('append_file refuses 16 MiB + 1 byte and preserves the file', async () => {
    await writeReal(kernel.root, 'bytes/append-over.txt', 'seed');
    const result = await appendFile(
      { path: 'bytes/append-over.txt', content: 'f'.repeat(BYTE_CAP + 1) },
      createRuntime(kernel),
    );

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
    assert.equal(await readReal(kernel.root, 'bytes/append-over.txt'), 'seed');
  });

  it('append_file_multi accounts for the aggregate byte budget', async () => {
    const paths = await seedFiles(2, 'bytes/multi', 'seed');
    const runtime = createRuntime(kernel, fakeSearch(paths));
    const result = await appendFileMulti(
      { pattern: '**/*.txt', content: 'g'.repeat(BYTE_CAP) },
      runtime,
    );

    assert.equal(result.status, 'aborted');
    assert.equal(errorCode(result), 'BATCH_LIMIT_EXCEEDED');
    await assertAllContent(paths, 'seed');
  });

  it('search_replace admits an aggregate payload under the cap', async () => {
    await writeReal(kernel.root, 'bytes/replace-ok.txt', 'needle');
    const result = await searchReplaceMulti(
      {
        pattern: '**/*.txt',
        search: 'needle',
        replace: 'h'.repeat(BYTE_CAP - 6),
      },
      createRuntime(kernel, fakeSearch(['bytes/replace-ok.txt'])),
    );

    assert.equal(result.status, 'success');
  });
});

describe('Goal 3 — concurrency boundary through the real driver', () => {
  it('never exceeds 8 simultaneous driver calls for 20 candidates', async () => {
    const driver = new CountingDriver();
    const countingKernel = await bootVerificationKernel({
      prefix: 'brud-fs-verify-concurrency-',
      storageDriver: driver,
      withoutMutationRecording: true,
    });

    try {
      const paths: string[] = [];

      for (let index = 0; index < 20; index += 1) {
        const path = `concurrent/${String(index).padStart(2, '0')}.txt`;
        await writeReal(countingKernel.root, path, 'seed');
        paths.push(path);
      }

      const runtime = createRuntime(countingKernel, fakeSearch(paths));
      driver.reset();

      const result = await appendFileMulti(
        { pattern: '**/*.txt', content: 'Y' },
        runtime,
      );

      assert.equal(result.status, 'success');
      const data = result.data as { files: unknown[] };
      assert.equal(data.files.length, 20);
      assert.ok(
        driver.peak <= MAX_CONCURRENCY,
        `peak driver concurrency was ${driver.peak}, expected <= ${MAX_CONCURRENCY}`,
      );

      for (const path of paths) {
        assert.equal(await readReal(countingKernel.root, path), 'seed\n\nY');
      }
    } finally {
      await countingKernel.shutdown();
    }
  });
});