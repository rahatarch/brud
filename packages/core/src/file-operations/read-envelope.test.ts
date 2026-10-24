import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { executeFileOperations } from './index.js';
import type { FileOperation } from '../types/patch.js';
import { DEFAULT_SETTINGS } from '../settings/types.js';
import { parseReadEnvelope } from '../testing/readEnvelope.js';

describe('read operation response envelope', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-read-envelope-test-');
    nodeFs = new NodeFileSystem();
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('emits a lightweight summary descriptor instead of serialized file content', async () => {
    const filePath = pathModule.join(tempDir, 'descriptor.ts');
    const content = 'export const SECRET_SENTINEL = 42;\n';
    await nodeFs.writeFile(filePath, content);

    const operations: FileOperation[] = [
      { kind: 'read_file', path: filePath, isImportRead: false, maxDepth: 0, index: 'op-0' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);

    assert.strictEqual(result.operationResults.length, 1);
    const message = result.operationResults[0].message;
    assert.match(message, /Read summary \[operation 0\]/);
    assert.match(message, /delivered=1 file\(s\)/);
    assert.match(message, new RegExp(`bytes=${Buffer.byteLength(content, 'utf8')}`));
    assert.match(message, /skipped=0/);
    assert.match(message, /truncated=no/);
    assert.ok(!message.includes('SECRET_SENTINEL'), 'individual result must not embed raw file content');
    assert.ok(!message.includes(content), 'individual result must not embed the full source text');

    const parsed = parseReadEnvelope(result.message);
    assert.strictEqual(parsed.readResults.length, 1);
    assert.strictEqual(parsed.readResults[0].files[0].content, content);
  });

  it('reports aggregate failure when a read operation fails while another delivers data', async () => {
    const filePath = pathModule.join(tempDir, 'partial.ts');
    await nodeFs.writeFile(filePath, 'const partial = true;\n');

    const operations: FileOperation[] = [
      { kind: 'read_file', path: filePath, isImportRead: false, maxDepth: 0, index: 'op-0' },
      { kind: 'read_file', path: '/etc/definitely-outside-workspace.ts', isImportRead: false, maxDepth: 0, index: 'op-1' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);

    assert.strictEqual(result.success, false);
    assert.ok(result.errors.length > 0, 'expected accumulated errors in aggregate result');

    const parsed = parseReadEnvelope(result.message);
    assert.strictEqual(parsed.readResults.length, 1);
    assert.strictEqual(parsed.readResults[0].files[0].content, 'const partial = true;\n');
  });

  it('carries full files, counts, sizes, skips and truncation indicators in combined read results', async () => {
    const dirPath = pathModule.join(tempDir, 'combined');
    await nodeFs.createDirectory(dirPath);
    const fileA = pathModule.join(dirPath, 'a.ts');
    const fileB = pathModule.join(dirPath, 'b.ts');
    const contentA = 'const a = 1;\n';
    const contentB = 'const b = 2;\n';
    await nodeFs.writeFile(fileA, contentA);
    await nodeFs.writeFile(fileB, contentB);

    const operations: FileOperation[] = [
      {
        kind: 'read_directory',
        directoryPath: dirPath,
        recursive: true,
        isImportRead: false,
        maxDepth: 0,
        index: 'op-0',
      },
      {
        kind: 'read_file',
        path: pathModule.join(dirPath, 'missing.ts'),
        isImportRead: false,
        maxDepth: 0,
        index: 'op-1',
      },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir], undefined, undefined, undefined, undefined, undefined, {
      ...DEFAULT_SETTINGS,
      readMaxAggregateBytes: Buffer.byteLength(contentA, 'utf8'),
    });

    const parsed = parseReadEnvelope(result.message);
    assert.ok(Array.isArray(parsed.readResults));
    assert.strictEqual(parsed.readResults.length, 2);

    const directoryResult = parsed.readResults.find((r) => r.operationIndex === 0);
    assert.ok(directoryResult, 'expected read_directory entry');
    assert.strictEqual(directoryResult.files.length, 1);
    assert.strictEqual(directoryResult.totalFiles, 1);
    assert.strictEqual(directoryResult.totalSize, Buffer.byteLength(contentA, 'utf8'));
    assert.strictEqual(directoryResult.truncated, true);
    assert.strictEqual(directoryResult.limitHit, 'bytes');
    assert.deepStrictEqual(directoryResult.skips, []);

    const missingResult = parsed.readResults.find((r) => r.operationIndex === 1);
    assert.ok(missingResult, 'expected skipped read_file entry');
    assert.strictEqual(missingResult.totalFiles, 0);
    assert.strictEqual(missingResult.totalSize, 0);
    assert.ok(Array.isArray(missingResult.skips));
    assert.strictEqual(missingResult.skips.length, 1);
    assert.strictEqual(missingResult.skips[0].reason, 'unreadable');
    assert.ok(missingResult.skips[0].path.endsWith('missing.ts'));

    const summary = result.operationResults[0].message;
    assert.match(summary, /truncated=yes/);
    assert.match(summary, /limit=bytes/);
    assert.match(result.operationResults[1].message, /skipped=1/);
  });

  it('surfaces BATCH_LIMIT_EXCEEDED as a structured error and preserves the directory target', async () => {
    const directoryName = 'batch-limit';
    const directoryPath = pathModule.join(tempDir, directoryName);
    await fs.mkdir(directoryPath, { recursive: true });
    await Promise.all(
      Array.from({ length: 101 }, (_, index) => fs.writeFile(pathModule.join(directoryPath, `file-${index}.txt`), 'x')),
    );

    const operations: FileOperation[] = [
      {
        kind: 'read_directory',
        directoryPath: directoryName,
        recursive: false,
        isImportRead: false,
        maxDepth: 0,
        index: 'op-limit',
      },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors.length, 1);

    const error = result.errors[0];
    assert.strictEqual(error.code, 'BATCH_LIMIT_EXCEEDED');
    assert.ok(error instanceof Error, 'structured errors must be real Error instances');
    assert.strictEqual(error.friendly, 'Read batch too large.');
    assert.ok(error.details.includes('Requested 101 files'));
    assert.ok(error.details.includes('the limit is 100 per batch'));
    assert.ok(!error.details.includes('[object Object]'));

    assert.strictEqual(result.operationResults.length, 1);
    const operationResult = result.operationResults[0];
    assert.strictEqual(operationResult.status, 'failed');
    assert.strictEqual(operationResult.path, directoryName);
    assert.ok(!operationResult.message.includes('[object Object]'));
    assert.strictEqual(operationResult.code, 'BATCH_LIMIT_EXCEEDED');
    assert.ok(operationResult.details?.includes('Requested 101 files'));
    assert.ok(operationResult.details?.includes('the limit is 100 per batch'));
  });

  it('does not attach diagnostic keys to successful operation results', async () => {
    const filePath = pathModule.join(tempDir, 'clean-success.ts');
    await nodeFs.writeFile(filePath, 'export const ok = true;\n');

    const operations: FileOperation[] = [
      { kind: 'read_file', path: filePath, isImportRead: false, maxDepth: 0, index: 'op-clean' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);

    const operationResult = result.operationResults[0];
    assert.strictEqual(operationResult.status, 'success');
    assert.strictEqual('code' in operationResult, false);
    assert.strictEqual('details' in operationResult, false);
  });
});
