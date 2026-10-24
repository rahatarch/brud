import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { InMemoryStorageDriver } from '../../../../drivers/memory/index.js';
import { BrudFileSystem } from '../../../BrudFileSystem/orchestrator/BrudFileSystem.js';
import { captureBaseline, detectBinaryContent } from './captureBaseline.js';
import { InvalidBaselinePathError } from './types.js';

const SESSION_ID = 'BR-20260131-001';

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

describe('captureBaseline', () => {
  it('captures text files with SHA-256 digests and text payloads', async () => {
    const { fileSystem } = await createHarness();
    const content = 'export const value = 42;\n';
    await fileSystem.createFile('src/index.ts', content);

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['src/index.ts'],
      capturedAt: '2026-01-31T12:00:00.000Z',
    });

    assert.equal(snapshot.sessionId, SESSION_ID);
    assert.equal(snapshot.capturedAt, '2026-01-31T12:00:00.000Z');

    const target = snapshot.targets['src/index.ts'];
    assert.ok(target);
    assert.equal(target.text, content);
    assert.equal(target.content, undefined);
    assert.equal(target.digest.exists, true);
    assert.equal(target.digest.isBinary, false);
    assert.equal(target.digest.relativePath, 'src/index.ts');
    assert.equal(target.digest.sizeBytes, Buffer.byteLength(content, 'utf8'));
    assert.equal(target.digest.sha256, sha256(Buffer.from(content, 'utf8')));
  });

  it('captures empty files as empty text', async () => {
    const { fileSystem } = await createHarness();
    await fileSystem.createFile('empty.txt', '');

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['empty.txt'],
    });

    const target = snapshot.targets['empty.txt'];
    assert.ok(target);
    assert.equal(target.text, '');
    assert.equal(target.digest.sizeBytes, 0);
    assert.equal(target.digest.sha256, sha256(new Uint8Array(0)));
  });

  it('marks nonexistent targets with exists false and no payload', async () => {
    const { fileSystem } = await createHarness();

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['src/missing.ts'],
    });

    const target = snapshot.targets['src/missing.ts'];
    assert.ok(target);
    assert.equal(target.digest.exists, false);
    assert.equal(target.digest.sha256, '');
    assert.equal(target.digest.sizeBytes, 0);
    assert.equal(target.digest.isBinary, false);
    assert.equal(target.digest.relativePath, 'src/missing.ts');
    assert.equal(target.text, undefined);
    assert.equal(target.content, undefined);
    assert.equal('text' in target, false);
    assert.equal('content' in target, false);
  });

  it('detects binary files and stores the raw byte buffer', async () => {
    const { fileSystem } = await createHarness();
    const payload = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x01]);
    await fileSystem.createFile('assets/archive.bin', payload);

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['assets/archive.bin'],
    });

    const target = snapshot.targets['assets/archive.bin'];
    assert.ok(target);
    assert.equal(target.digest.exists, true);
    assert.equal(target.digest.isBinary, true);
    assert.equal(target.digest.sizeBytes, payload.byteLength);
    assert.equal(target.digest.sha256, sha256(payload));
    assert.ok(target.content);
    assert.deepEqual(Array.from(target.content), Array.from(payload));
    assert.equal(target.text, undefined);
  });

  it('treats files without null bytes as text even with high bytes set', async () => {
    const { fileSystem } = await createHarness();
    await fileSystem.createFile('utf8.txt', 'héllo — 世界');

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['utf8.txt'],
    });

    const target = snapshot.targets['utf8.txt'];
    assert.ok(target);
    assert.equal(target.digest.isBinary, false);
    assert.equal(target.text, 'héllo — 世界');
  });

  it('normalizes every key to a workspace-relative path', async () => {
    const { fileSystem } = await createHarness();
    await fileSystem.createFile('src/deep/index.ts', 'payload');

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['./src/deep/index.ts', 'src\\deep\\index.ts', 'src/deep/index.ts'],
    });

    assert.deepEqual(Object.keys(snapshot.targets), ['src/deep/index.ts']);

    for (const key of Object.keys(snapshot.targets)) {
      assert.equal(key.startsWith('/'), false);
      assert.equal(key.includes('\\'), false);
      assert.equal(key.includes('..'), false);
      assert.equal(snapshot.targets[key]?.digest.relativePath, key);
    }
  });

  it('rejects absolute and traversing target paths', async () => {
    const { fileSystem } = await createHarness();

    const invalidPaths = ['/etc/passwd', 'C:\\Windows\\system.ini', '../outside.txt', 'src/../../outside.txt'];

    for (const path of invalidPaths) {
      await assert.rejects(
        captureBaseline({ fileSystem, sessionId: SESSION_ID, relativePaths: [path] }),
        (error: unknown) => error instanceof InvalidBaselinePathError,
      );
    }
  });

  it('rejects empty target paths', async () => {
    const { fileSystem } = await createHarness();

    await assert.rejects(
      captureBaseline({ fileSystem, sessionId: SESSION_ID, relativePaths: [''] }),
      (error: unknown) => error instanceof InvalidBaselinePathError && error.reason === 'EMPTY_PATH',
    );
  });

  it('returns an empty target map when no paths are requested', async () => {
    const { fileSystem } = await createHarness();

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: [],
    });

    assert.deepEqual(snapshot.targets, {});
  });

  it('captures mixed existing and missing targets in one pass', async () => {
    const { fileSystem } = await createHarness();
    await fileSystem.createFile('a.txt', 'a');
    await fileSystem.createFile('nested/b.bin', Uint8Array.from([0x00, 0x01]));

    const snapshot = await captureBaseline({
      fileSystem,
      sessionId: SESSION_ID,
      relativePaths: ['a.txt', 'nested/b.bin', 'c.txt'],
    });

    assert.deepEqual(Object.keys(snapshot.targets).sort(), ['a.txt', 'c.txt', 'nested/b.bin']);
    assert.equal(snapshot.targets['a.txt']?.digest.exists, true);
    assert.equal(snapshot.targets['nested/b.bin']?.digest.isBinary, true);
    assert.equal(snapshot.targets['c.txt']?.digest.exists, false);
  });

  it('limits binary detection to the configured probe window', () => {
    const bytes = Uint8Array.from([1, 2, 3, 0, 4]);

    assert.equal(detectBinaryContent(bytes), true);
    assert.equal(detectBinaryContent(bytes, 3), false);
    assert.equal(detectBinaryContent(bytes, 0), false);
  });
});
