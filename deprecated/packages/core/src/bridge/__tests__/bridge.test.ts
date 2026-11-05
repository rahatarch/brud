import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { bootCoreKernel } from '../legacyBridge.js';
import { NodeFileSystem } from '../../testing/nodeFileSystem.js';
import { TestHistoryStore } from '../../testing/testHistoryStore.js';

describe('Bridge Kernel Integration', () => {
  let tempDir: string;
  let originalCwd: string;
  let nodeFs: NodeFileSystem;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-bridge-test-');
    nodeFs = new NodeFileSystem();
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('registers all 21 legacy operations', async () => {
    const kernel = await bootCoreKernel({ fs: nodeFs });

    assert.ok(kernel.operations.has('create_file'));
    assert.ok(kernel.operations.has('delete_file'));
    assert.ok(kernel.operations.has('search_replace'));
    assert.ok(kernel.operations.has('rename_file'));
    assert.ok(kernel.operations.has('move_file'));
    assert.ok(kernel.operations.has('copy_file'));
    assert.ok(kernel.operations.has('append_file'));
    assert.ok(kernel.operations.has('create_directory'));
    assert.ok(kernel.operations.has('delete_directory'));
    assert.ok(kernel.operations.has('move_directory'));
    assert.ok(kernel.operations.has('extract_structure'));
    assert.ok(kernel.operations.has('codebase_metadata'));
    assert.ok(kernel.operations.has('search_files'));
    assert.ok(kernel.operations.has('append_file_multi'));
    assert.ok(kernel.operations.has('search_replace_multi'));
    assert.ok(kernel.operations.has('read_file'));
    assert.ok(kernel.operations.has('read_files'));
    assert.ok(kernel.operations.has('read_directory'));
    assert.ok(kernel.operations.has('terminal_interactive'));
    assert.ok(kernel.operations.has('terminal_command'));
    assert.ok(kernel.operations.has('get_tool_info'));
    assert.strictEqual(kernel.operations.list().length, 21);
  });

  it('creates a file through kernel dispatch and verifies on disk', async () => {
    const history = new TestHistoryStore(tempDir, nodeFs);
    const kernel = await bootCoreKernel({ fs: nodeFs, history });

    const result = await kernel.execute('create_file', {
      path: 'test-bridge.txt',
      content: 'Hello from Microkernel!',
    });

    assert.strictEqual(result.status, 'success');
    assert.ok(result.data);

    const resolvedPath = pathModule.join(tempDir, 'test-bridge.txt');
    const exists = await nodeFs.exists(resolvedPath);
    assert.strictEqual(exists, true, 'file should exist on disk after kernel create_file');
    const diskContent = await nodeFs.readFile(resolvedPath);
    assert.strictEqual(diskContent, 'Hello from Microkernel!', 'file content should match');
  });

  it('deletes a file through kernel dispatch and verifies removal', async () => {
    const history = new TestHistoryStore(tempDir, nodeFs);
    const kernel = await bootCoreKernel({ fs: nodeFs, history });

    const filePath = 'test-bridge-delete.txt';
    const resolvedPath = pathModule.join(tempDir, filePath);
    await nodeFs.writeFile(resolvedPath, 'delete me');

    const result = await kernel.execute('delete_file', {
      path: filePath,
    });

    assert.strictEqual(result.status, 'success');
    const exists = await nodeFs.exists(resolvedPath);
    assert.strictEqual(exists, false, 'file should be deleted from disk');
  });

  it('rejects paths outside workspaceRoot', async () => {
    const history = new TestHistoryStore(tempDir, nodeFs);
    const kernel = await bootCoreKernel({ fs: nodeFs, history });

    const result = await kernel.execute('create_file', {
      path: '/tmp/outside-workspace.txt',
      content: 'should not be created',
    });

    assert.strictEqual(result.status, 'failed');
    assert.ok(result.error, 'should report an error for path outside workspace');
  });

  it('executes codebase_metadata through kernel with status success and JSON message', async () => {
    const kernel = await bootCoreKernel({ fs: nodeFs });

    const result = await kernel.execute('codebase_metadata', {
      path: '.',
    });

    assert.strictEqual(result.status, 'success');
    assert.ok(result.message, 'message should be non-empty');
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.message);
    } catch {
      assert.fail('result.message should be valid JSON');
    }
    assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
    const obj = parsed as Record<string, unknown>;
    assert.ok('codebase_metadata' in obj, 'message should contain codebase_metadata key');
    const meta = obj.codebase_metadata as Record<string, unknown>;
    assert.ok(typeof meta.totalFiles === 'number', 'codebase_metadata.totalFiles should be a number');
  });

  it('executes codebase_metadata with history undefined without throwing', async () => {
    const kernel = await bootCoreKernel({ fs: nodeFs });

    await assert.doesNotReject(
      async () => kernel.execute('codebase_metadata', { path: '.' }),
    );
  });

  it('executes read_file through kernel and bypasses history scaffolding', async () => {
    const filePath = 'read-test-bypass.txt';
    const resolvedPath = pathModule.join(tempDir, filePath);
    await nodeFs.writeFile(resolvedPath, 'read bypass test content');

    const kernel = await bootCoreKernel({ fs: nodeFs });

    const result = await kernel.execute('read_file', {
      path: filePath,
    });

    assert.strictEqual(result.status, 'success');
    assert.ok(result.message, 'message should be non-empty');
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.message);
    } catch {
      assert.fail('result.message for read_file should be valid JSON');
    }
    const obj = parsed as Record<string, unknown>;
    assert.ok(obj, 'should have parsed content');
  });
});