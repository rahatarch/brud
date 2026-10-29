import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as pathModule from 'node:path';
import { NodeFileSystem } from '../testing/nodeFileSystem.js';
import { TestHistoryStore } from '../testing/testHistoryStore.js';
import { createTestWorkspace, cleanupTestWorkspace } from '../testing/testUtils.js';
import { executeFileOperations } from './index.js';
import type { FileOperation } from '../types/patch.js';
import type { TerminalExecutor } from '../terminal/types.js';
import type { ITerminalService } from '@brud/kernel' with { 'resolution-mode': 'import' };
import {
  bindTerminalAuthority,
  createTerminalExecutor,
  terminalAuthority,
} from '../terminal/index.js';

/**
 * The kernel constructor a real host boots.
 *
 * Resolved through `require` so the test compiles to the package's CommonJS
 * output; `node --import tsx --test` loads the same module instance.
 */
const KernelTerminalService = (require('@brud/kernel') as unknown as {
  readonly TerminalService: new (options: {
    readonly workspaceRoot?: string;
    readonly __allowUnsafeTestExecution?: boolean;
  }) => ITerminalService;
}).TerminalService;

const SETTINGS = {
  workspaceBoundaryEnabled: true,
  commandValidationEnabled: true,
  toolAllowList: {},
};

describe('terminal command routing through the kernel authority', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let workspaceFolders: string[];
  let historyStore: TestHistoryStore;
  let terminal: TerminalExecutor;

  before(async () => {
    tempDir = await createTestWorkspace('brud-terminal-routing-');
    nodeFs = new NodeFileSystem();
    workspaceFolders = [tempDir];
    historyStore = new TestHistoryStore(tempDir, nodeFs);
    // Binding the kernel authority is what a host does at boot; from then on
    // the dispatcher routes every terminal operation through it.
    // This suite drives the routing layer, not the validation gate, so it
    // runs the kernel engine under the explicit test-only escape. The hosted
    // binding and the standalone fallback both attach a real authority.
    bindTerminalAuthority(
      new KernelTerminalService({ workspaceRoot: tempDir, __allowUnsafeTestExecution: true }),
    );
    terminal = createTerminalExecutor();
  });

  after(async () => {
    bindTerminalAuthority(undefined);
    await cleanupTestWorkspace(tempDir);
  });

  it('executes through the kernel authority even when a stub executor is injected', async () => {
    const rejecting: TerminalExecutor = {
      execute: async () => { throw new Error('stub.execute called'); },
      executeCommand: async () => { throw new Error('stub.executeCommand called'); },
      executeSequential: async () => { throw new Error('stub.executeSequential called'); },
      executeParallel: async () => { throw new Error('stub.executeParallel called'); },
      executeConditional: async () => { throw new Error('stub.executeConditional called'); },
    };
    const ops: FileOperation[] = [
      { kind: 'terminal_command', command: 'echo via-kernel', index: '1', path: '' } as FileOperation,
    ];

    const result = await executeFileOperations(
      ops,
      nodeFs,
      workspaceFolders,
      historyStore,
      undefined,
      rejecting,
      undefined,
      undefined,
      SETTINGS,
    );

    assert.strictEqual(result.success, true);
    assert.ok(String(result.operationResults[0].message).includes('via-kernel'));
  });

  it('executes through the kernel service and reports success', async () => {
    const ops: FileOperation[] = [
      { kind: 'terminal_command', command: 'echo routed', index: '1', path: '' } as FileOperation,
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
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operationResults[0].status, 'success');
    assert.ok(String(result.operationResults[0].message).includes('routed'));
  });

  it('never executes an onFailure branch the primary command did not reach', async () => {
    const ops: FileOperation[] = [
      {
        kind: 'terminal_command',
        command: 'echo primary',
        index: '1',
        path: '',
        onFailure: { type: 'sequential', commands: ['rm -rf /'] },
      } as FileOperation,
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
    );

    // The primary succeeded, so the failure branch is never reached and the
    // dangerous command is never spawned. (Gate-level refusal of a branch
    // before any spawn is covered by the kernel security suite, where the
    // validation authority is wired.)
    assert.strictEqual(result.success, true);
    assert.strictEqual(terminalAuthority().activeSessions().length, 0);
  });

  it('maps a killed command onto the interrupted code', async () => {
    const ops: FileOperation[] = [
      {
        kind: 'terminal_command',
        command: 'node -e "setTimeout(()=>{}, 5000)"',
        index: '1',
        path: '',
      } as FileOperation,
    ];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 250);

    try {
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

      assert.strictEqual(result.operationResults[0].status, 'interrupted');
      assert.strictEqual(result.errors[0].code, 'TERMINAL_INTERRUPTED');
    } finally {
      clearTimeout(timer);
    }
  });

  it('reports a timeout as TERMINAL_TIMEOUT instead of EXECUTION_FAILED -1', async () => {
    const ops: FileOperation[] = [
      {
        kind: 'terminal_command',
        command: 'sleep 30',
        index: '1',
        path: '',
        timeout: 1,
      } as FileOperation,
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
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors[0].code, 'TERMINAL_TIMEOUT');
    assert.strictEqual(result.operationResults[0].code, 'TERMINAL_TIMEOUT');
  });

  it('records the resolved command path relative to the workspace', async () => {
    const ops: FileOperation[] = [
      {
        kind: 'terminal_command',
        command: 'pwd',
        index: '1',
        path: '',
        cwd: tempDir,
      } as FileOperation,
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
    );
    const output = String((result.operationResults[0].data as { output?: string } | undefined)?.output ?? '');

    assert.ok(output.includes(pathModule.basename(tempDir)), output);
  });
});
