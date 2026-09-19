import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../testing/testUtils.js';
import { executeFileOperations } from './index.js';
import type { FileOperation } from '../types/patch.js';

describe('Settings enforcement during execution', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let workspaceFolders: string[];
  let resolve: (rel: string) => string;
  let writeFile: (rel: string, content: string) => Promise<void>;

  before(async () => {
    tempDir = await createTestWorkspace('brud-settings-enforcement-');
    nodeFs = new NodeFileSystem();
    workspaceFolders = [tempDir];
    resolve = (rel: string) => pathModule.join(tempDir, rel);
    writeFile = async (rel: string, content: string) => {
      await nodeFs.writeFile(resolve(rel), content);
    };
  });

  after(async () => {
    await cleanupTestWorkspace(tempDir);
  });

  it('a) Tool disabled in allow list fails with TOOL_DISABLED', async () => {
    const ops: FileOperation[] = [
      { kind: 'create_file', path: resolve('test.txt'), index: '1', content: 'hello' },
    ];
    const result = await executeFileOperations(
      ops, nodeFs, workspaceFolders, undefined, undefined, undefined, undefined, undefined,
      { workspaceBoundaryEnabled: true, toolAllowList: { create_file: false } },
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].code, 'TOOL_DISABLED');
    assert.strictEqual(result.operationResults[0].status, 'failed');
  });

  it('b) Tool enabled in allow list executes normally', async () => {
    const ops: FileOperation[] = [
      { kind: 'create_file', path: resolve('enabled-test.txt'), index: '1', content: 'world' },
    ];
    const result = await executeFileOperations(
      ops, nodeFs, workspaceFolders, undefined, undefined, undefined, undefined, undefined,
      { workspaceBoundaryEnabled: true, toolAllowList: { create_file: true } },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operationResults[0].status, 'success');
    const content = await nodeFs.readFile(resolve('enabled-test.txt'));
    assert.strictEqual(content, 'world');
  });

  it('c) All tools enabled by default (empty allow list)', async () => {
    const ops: FileOperation[] = [
      { kind: 'create_file', path: resolve('default-enabled.txt'), index: '1', content: 'default' },
    ];
    const result = await executeFileOperations(
      ops, nodeFs, workspaceFolders, undefined, undefined, undefined, undefined, undefined,
      { workspaceBoundaryEnabled: true, toolAllowList: {} },
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operationResults[0].status, 'success');
  });

  it('d) Workspace boundary disabled allows path outside workspace', async () => {
    const outsidePath = '/tmp/brud-outside-test.txt';
    try { await nodeFs.deleteFile(outsidePath); } catch {}
    const ops: FileOperation[] = [
      { kind: 'create_file', path: outsidePath, index: '1', content: 'outside' },
    ];
    const result = await executeFileOperations(
      ops, nodeFs, workspaceFolders, undefined, undefined, undefined, undefined, undefined,
      { workspaceBoundaryEnabled: false, toolAllowList: {} },
    );
    assert.strictEqual(result.operationResults[0].status !== 'failed', true);
    assert.ok(result.errors.length === 0 || result.errors.every(e => e.code !== 'PATH_OUTSIDE_WORKSPACE'));
  });

  it('e) Workspace boundary enabled rejects path outside workspace', async () => {
    const outsidePath = '/tmp/brud-outside-reject.txt';
    const ops: FileOperation[] = [
      { kind: 'create_file', path: outsidePath, index: '1', content: 'outside' },
    ];
    const result = await executeFileOperations(
      ops, nodeFs, workspaceFolders, undefined, undefined, undefined, undefined, undefined,
      { workspaceBoundaryEnabled: true, toolAllowList: {} },
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operationResults[0].status, 'failed');
    assert.ok(result.operationResults[0].message.includes('outside the workspace') ||
              result.operationResults[0].path === outsidePath);
  });
});