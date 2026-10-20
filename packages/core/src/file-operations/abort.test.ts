import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as pathModule from 'path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { TestHistoryStore } from '../testing/testHistoryStore.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../testing/testUtils.js';
import { executeFileOperations } from './index.js';
import type { FileOperation } from '../types/patch.js';
import type { TerminalExecutor } from '../terminal/types.js';
import {
  executeCommand,
  executeConditional,
  executeParallel,
  executeSequential,
  executeTerminalCommand,
} from '../terminal/executor.js';

const SETTINGS = {
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: {},
};

describe('Abort signal propagation', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let workspaceFolders: string[];
  let historyStore: TestHistoryStore;
  let terminal: TerminalExecutor;
  let resolve: (rel: string) => string;

  before(async () => {
    tempDir = await createTestWorkspace('brud-abort-');
    nodeFs = new NodeFileSystem();
    workspaceFolders = [tempDir];
    historyStore = new TestHistoryStore(tempDir, nodeFs);
    resolve = (rel: string) => pathModule.join(tempDir, rel);
    terminal = {
      execute: executeTerminalCommand,
      executeCommand,
      executeSequential,
      executeParallel,
      executeConditional,
    };
  });

  after(async () => {
    await cleanupTestWorkspace(tempDir);
  });

  it('starts nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ops: FileOperation[] = [
      { kind: 'create_file', path: resolve('pre-aborted.txt'), index: '1', content: 'nope' },
    ];

    const result = await executeFileOperations(
      ops,
      nodeFs,
      workspaceFolders,
      historyStore,
      undefined,
      terminal,
      undefined,
      undefined,
      SETTINGS,
      controller.signal,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operationResults.length, 1);
    assert.strictEqual(result.operationResults[0].status, 'interrupted');
    assert.ok(!(await nodeFs.exists(resolve('pre-aborted.txt'))));
  });

  it('stops a running command and marks the remaining operations interrupted', async () => {
    const controller = new AbortController();
    const ops: FileOperation[] = [
      {
        kind: 'terminal_command',
        command: 'node -e "setTimeout(()=>{}, 3000)"',
        index: '1',
        path: '',
      } as FileOperation,
      { kind: 'create_file', path: resolve('after-abort.txt'), index: '2', content: 'nope' },
    ];

    const timer = setTimeout(() => controller.abort(), 250);
    const started = Date.now();
    const result = await executeFileOperations(
      ops,
      nodeFs,
      workspaceFolders,
      historyStore,
      undefined,
      terminal,
      undefined,
      undefined,
      SETTINGS,
      controller.signal,
    );
    const elapsed = Date.now() - started;
    clearTimeout(timer);

    assert.ok(elapsed < 2500, `command should stop promptly, took ${elapsed}ms`);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operationResults[0].status, 'interrupted');
    assert.strictEqual(result.operationResults[1].status, 'interrupted');
    assert.ok(!(await nodeFs.exists(resolve('after-abort.txt'))));
  });
});
