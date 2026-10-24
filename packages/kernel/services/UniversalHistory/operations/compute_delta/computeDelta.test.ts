import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import type {
  BaselineTarget,
  TargetDigest,
} from '../../contracts/IUniversalHistoryService/types.js';
import {
  DEFAULT_BINARY_SIZE_THRESHOLD,
  computeDelta,
  createUnifiedDiff,
} from './computeDelta.js';

interface Harness {
  readonly fileSystem: BrudFileSystem;
  readonly driver: InMemoryStorageDriver;
}

async function createHarness(): Promise<Harness> {
  const driver = new InMemoryStorageDriver();
  const fileSystem = new BrudFileSystem('/workspace', driver);
  await fileSystem.initialize();
  return { fileSystem, driver };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function existingDigest(relativePath: string, text: string): TargetDigest {
  return {
    relativePath,
    sha256: sha256(Buffer.from(text, 'utf8')),
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    isBinary: false,
    exists: true,
  };
}

function missingDigest(relativePath: string): TargetDigest {
  return {
    relativePath,
    sha256: '',
    sizeBytes: 0,
    isBinary: false,
    exists: false,
  };
}

function payload(text: string): BaselineTarget {
  return { text, digest: existingDigest('payload', text) };
}

describe('computeDelta', () => {
  it('produces a standard unified diff for text modifications', async () => {
    const { fileSystem } = await createHarness();
    const before = 'const value = 1;\n';
    const after = 'const value = 2;\n';
    await fileSystem.createFile('src/index.ts', after);

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'src/index.ts',
      baseline: existingDigest('src/index.ts', before),
      baselinePayload: payload(before),
    });

    assert.equal(delta.changeKind, 'modified');
    assert.equal(delta.isChanged, true);
    assert.equal(delta.isBinary, false);
    assert.equal(delta.blobPayload, null);
    assert.equal(delta.diffContent, createUnifiedDiff('src/index.ts', before, after));
    assert.equal(
      delta.diffContent,
      [
        '--- a/src/index.ts\n',
        '+++ b/src/index.ts\n',
        '@@ -1 +1 @@\n',
        '-const value = 1;\n',
        '+const value = 2;\n',
      ].join(''),
    );
    assert.equal(delta.preDigest.sha256, sha256(Buffer.from(before, 'utf8')));
    assert.equal(delta.postDigest.sha256, sha256(Buffer.from(after, 'utf8')));
    assert.equal(delta.postDigest.sizeBytes, Buffer.byteLength(after, 'utf8'));
    assert.equal(delta.postDigest.exists, true);
  });

  it('reports unchanged targets as not changed and omits payloads', async () => {
    const { fileSystem } = await createHarness();
    const content = 'export const stable = true;\n';
    await fileSystem.createFile('src/stable.ts', content);

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'src/stable.ts',
      baseline: existingDigest('src/stable.ts', content),
      baselinePayload: payload(content),
    });

    assert.equal(delta.isChanged, false);
    assert.equal(delta.changeKind, 'unchanged');
    assert.equal(delta.diffContent, null);
    assert.equal(delta.blobPayload, null);
    assert.equal(delta.postDigest.sha256, delta.preDigest.sha256);
  });

  it('marks deleted targets with a nonexistent post-digest and a deletion diff', async () => {
    const { fileSystem } = await createHarness();
    const before = 'const value = 1;\n';

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'src/index.ts',
      baseline: existingDigest('src/index.ts', before),
      baselinePayload: payload(before),
    });

    assert.equal(delta.isChanged, true);
    assert.equal(delta.changeKind, 'deleted');
    assert.equal(delta.postDigest.exists, false);
    assert.equal(delta.postDigest.sha256, '');
    assert.equal(delta.postDigest.sizeBytes, 0);
    assert.equal(delta.blobPayload, null);
    assert.equal(
      delta.diffContent,
      [
        '--- a/src/index.ts\n',
        '+++ /dev/null\n',
        '@@ -1 +0,0 @@\n',
        '-const value = 1;\n',
      ].join(''),
    );
  });

  it('marks created targets with a nonexistent pre-digest', async () => {
    const { fileSystem } = await createHarness();
    const content = 'export const created = true;\n';
    await fileSystem.createFile('src/new.ts', content);

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'src/new.ts',
      baseline: missingDigest('src/new.ts'),
    });

    assert.equal(delta.isChanged, true);
    assert.equal(delta.changeKind, 'created');
    assert.equal(delta.preDigest.exists, false);
    assert.equal(delta.isBinary, false);
    assert.equal(delta.blobPayload, null);
    assert.equal(
      delta.diffContent,
      [
        '--- /dev/null\n',
        '+++ b/src/new.ts\n',
        '@@ -0,0 +1 @@\n',
        '+export const created = true;\n',
      ].join(''),
    );
  });

  it('treats targets that never existed as unchanged', async () => {
    const { fileSystem } = await createHarness();

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'src/never.ts',
      baseline: missingDigest('src/never.ts'),
    });

    assert.equal(delta.isChanged, false);
    assert.equal(delta.changeKind, 'unchanged');
    assert.equal(delta.diffContent, null);
    assert.equal(delta.blobPayload, null);
    assert.equal(delta.postDigest.exists, false);
  });

  it('routes binary content to a raw blob payload', async () => {
    const { fileSystem } = await createHarness();
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
    await fileSystem.createFile('assets/archive.bin', bytes);

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'assets/archive.bin',
      baseline: missingDigest('assets/archive.bin'),
    });

    assert.equal(delta.changeKind, 'created');
    assert.equal(delta.isBinary, true);
    assert.equal(delta.diffContent, null);
    assert.ok(delta.blobPayload);
    assert.deepEqual(Array.from(delta.blobPayload), Array.from(bytes));
    assert.equal(delta.postDigest.sha256, sha256(bytes));
    assert.equal(delta.postDigest.isBinary, true);
  });

  it('routes text at or above the size threshold to a blob payload', async () => {
    const { fileSystem } = await createHarness();
    const content = 'x'.repeat(DEFAULT_BINARY_SIZE_THRESHOLD);
    await fileSystem.createFile('logs/huge.txt', content);

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'logs/huge.txt',
      baseline: missingDigest('logs/huge.txt'),
    });

    assert.equal(delta.isBinary, true);
    assert.equal(delta.diffContent, null);
    assert.equal(delta.postDigest.sizeBytes, DEFAULT_BINARY_SIZE_THRESHOLD);
    assert.equal(delta.blobPayload?.byteLength, DEFAULT_BINARY_SIZE_THRESHOLD);
  });

  it('honors a custom size threshold', async () => {
    const { fileSystem } = await createHarness();
    await fileSystem.createFile('notes.txt', 'small text payload');

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'notes.txt',
      baseline: missingDigest('notes.txt'),
      binarySizeThreshold: 4,
    });

    assert.equal(delta.isBinary, true);
    assert.equal(delta.diffContent, null);
    assert.ok(delta.blobPayload);
  });

  it('skips textual diffs for deleted binary targets', async () => {
    const { fileSystem } = await createHarness();
    const bytes = Uint8Array.from([0x00, 0x01, 0x02]);
    const baseline: TargetDigest = {
      relativePath: 'assets/deleted.bin',
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      isBinary: true,
      exists: true,
    };

    const delta = await computeDelta({
      fileSystem,
      relativePath: 'assets/deleted.bin',
      baseline,
    });

    assert.equal(delta.changeKind, 'deleted');
    assert.equal(delta.isBinary, true);
    assert.equal(delta.diffContent, null);
    assert.equal(delta.blobPayload, null);
  });

  it('handles multi-hunk diffs with context lines', () => {
    const before = [
      'line1\n',
      'line2\n',
      'line3\n',
      'line4\n',
      'line5\n',
      'line6\n',
      'line7\n',
      'line8\n',
      'line9\n',
      'line10\n',
    ].join('');
    const after = before.replace('line2\n', 'line2 changed\n').replace('line10\n', 'line10 changed\n');

    const diff = createUnifiedDiff('multi.txt', before, after);

    assert.match(diff, /@@ -1,5 \+1,5 @@/u);
    assert.match(diff, /@@ -7,4 \+7,4 @@/u);
    assert.match(diff, /-line2\n\+line2 changed\n/u);
    assert.match(diff, /-line10\n\+line10 changed\n/u);
  });

  it('renders a no-newline marker for unterminated lines', () => {
    const diff = createUnifiedDiff('tail.txt', 'no newline', 'still no newline');

    assert.match(diff, /\\ No newline at end of file\n/u);
  });
});
