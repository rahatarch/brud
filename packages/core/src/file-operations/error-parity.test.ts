import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem';
import { executeFileOperations } from './index';
import type { FileOperation } from '../types/patch';
import type { TerminalExecutor, TerminalResult, GroupResult } from '../terminal/types';

const OUTSIDE_FILE = path.join(os.tmpdir(), `brud-parity-outside-${process.pid}.txt`);

function createFailedExecutor(): TerminalExecutor {
  const failed: TerminalResult = {
    success: false,
    output: 'boom',
    exitCode: 7,
    duration: 3,
    status: 'failed',
  };
  const unsupported = async (): Promise<GroupResult> => {
    throw new Error('group execution is not stubbed');
  };
  return {
    execute: async () => failed,
    executeCommand: async () => failed,
    executeSequential: unsupported,
    executeParallel: unsupported,
    executeConditional: unsupported,
  };
}

describe('operation failure parity', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brud-parity-'));
    nodeFs = new NodeFileSystem();
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(OUTSIDE_FILE, { force: true });
  });

  it('attaches code, details and target for an out-of-workspace create_file', async () => {
    const operations: FileOperation[] = [
      { kind: 'create_file', path: OUTSIDE_FILE, content: 'x', index: '1' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);
    const operationResult = result.operationResults[0];

    assert.strictEqual(result.success, false);
    assert.strictEqual(operationResult.status, 'failed');
    assert.strictEqual(operationResult.code, 'PATH_OUTSIDE_WORKSPACE');
    assert.ok(operationResult.details?.includes('outside the current workspace'));
    assert.strictEqual(operationResult.path, OUTSIDE_FILE);
    assert.strictEqual(operationResult.to, undefined);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].code, 'PATH_OUTSIDE_WORKSPACE');
    assert.ok(result.errors[0] instanceof Error);
  });

  it('keeps the aborted status and both targets for a missing rename source', async () => {
    const operations: FileOperation[] = [
      { kind: 'rename_file', from: 'missing.txt', to: 'renamed.txt', index: '1' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);
    const operationResult = result.operationResults[0];

    assert.strictEqual(operationResult.status, 'aborted');
    assert.strictEqual(operationResult.code, 'FILE_NOT_FOUND');
    assert.ok(operationResult.details?.includes('missing.txt'));
    assert.strictEqual(operationResult.path, 'missing.txt');
    assert.strictEqual(operationResult.to, 'renamed.txt');
    assert.strictEqual(result.errors[0].code, 'FILE_NOT_FOUND');
  });

  it('resolves the directory target and custom message for search_files outside the workspace', async () => {
    const operations: FileOperation[] = [
      { kind: 'search_files', patterns: ['**/*.ts'], directory: '/tmp', recursive: false, maxResults: 5, index: '1' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);
    const operationResult = result.operationResults[0];

    assert.strictEqual(operationResult.status, 'failed');
    assert.strictEqual(operationResult.code, 'PATH_OUTSIDE_WORKSPACE');
    assert.strictEqual(operationResult.path, '/tmp');
    assert.strictEqual(operationResult.message, 'Search directory is outside workspace root: /tmp.');
    assert.strictEqual(result.errors[0].code, 'PATH_OUTSIDE_WORKSPACE');
  });

  it('records both from and to for a dual-path rename failure', async () => {
    await nodeFs.writeFile(path.join(tempDir, 'rename-source.txt'), 'content');

    const operations: FileOperation[] = [
      { kind: 'rename_file', from: 'rename-source.txt', to: OUTSIDE_FILE, index: '1' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);
    const operationResult = result.operationResults[0];

    assert.strictEqual(operationResult.status, 'failed');
    assert.strictEqual(operationResult.code, 'PATH_OUTSIDE_WORKSPACE');
    assert.strictEqual(operationResult.path, OUTSIDE_FILE);
    assert.strictEqual(operationResult.to, OUTSIDE_FILE);
    assert.ok(operationResult.details?.includes('outside the current workspace'));
    assert.strictEqual(result.errors[0].code, 'PATH_OUTSIDE_WORKSPACE');
  });

  it('resolves the toolKind target for a missing get_tool_info tool', async () => {
    const operations: FileOperation[] = [
      { kind: 'get_tool_info', toolKind: 'does_not_exist', index: '1' },
    ];

    const result = await executeFileOperations(operations, nodeFs, [tempDir]);
    const operationResult = result.operationResults[0];

    assert.strictEqual(operationResult.status, 'failed');
    assert.strictEqual(operationResult.code, 'TOOL_NOT_FOUND');
    assert.strictEqual(operationResult.path, 'does_not_exist');
    assert.strictEqual(result.errors[0].code, 'TOOL_NOT_FOUND');
  });

  it('records a structured EXECUTION_FAILED error for a non-zero terminal exit', async () => {
    const operations: FileOperation[] = [
      { kind: 'terminal_command', command: 'false-runner', index: '1' },
    ];

    const result = await executeFileOperations(
      operations,
      nodeFs,
      [tempDir],
      undefined,
      undefined,
      createFailedExecutor(),
    );
    const operationResult = result.operationResults[0];

    assert.strictEqual(operationResult.status, 'failed');
    assert.strictEqual(operationResult.code, 'EXECUTION_FAILED');
    assert.strictEqual(operationResult.path, 'false-runner');
    assert.ok(operationResult.details?.includes('exited with code 7'));
    assert.ok(operationResult.details?.includes('boom'));
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].code, 'EXECUTION_FAILED');
    assert.ok(result.errors[0] instanceof Error);
  });

  it('records per-file failures for append_file_multi and syncs the aggregate error', async () => {
    const lockedPath = path.join(tempDir, 'locked.txt');
    const openPath = path.join(tempDir, 'open.txt');
    await nodeFs.writeFile(lockedPath, 'locked');
    await nodeFs.writeFile(openPath, 'open');
    await fs.chmod(lockedPath, 0o000);

    try {
      const operations: FileOperation[] = [
        {
          kind: 'append_file_multi',
          patterns: ['**/*'],
          directory: tempDir,
          recursive: false,
          maxResults: 10,
          position: 'end',
          content: 'appended',
          index: '1',
        },
      ];

      const result = await executeFileOperations(operations, nodeFs, [tempDir]);
      const operationResult = result.operationResults[0];

      assert.strictEqual(operationResult.status, 'failed');
      assert.strictEqual(operationResult.code, 'EXECUTION_FAILED');
      assert.ok(operationResult.details?.includes('1 file(s) failed'));
      assert.ok(operationResult.fileResults);
      assert.strictEqual(operationResult.fileResults!.failed.length, 1);
      assert.ok(operationResult.fileResults!.failed[0].endsWith('locked.txt'));
      assert.strictEqual(operationResult.fileResults!.fileErrors?.length, 1);
      assert.ok(operationResult.fileResults!.fileErrors![0].path.includes('locked.txt'));
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].code, 'EXECUTION_FAILED');
    } finally {
      await fs.chmod(lockedPath, 0o644);
    }
  });
});
