import { workspaceContextOptions } from '../../../../../kernel/src/__tests__/support/workspaceContext.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IActionExecutionContext, OperationResult } from '@brud/kernel';
import type { IActionManager } from '@brud/service-actions';
import type { IBrudToolsService, IPluginExecutionContext } from '@brud/service-tools';
import { ActionManagerToken } from '../../../../../services/ActionManager/descriptor/tokens.js';
import { ACTION_MANAGER_DAEMON_CALLER_ID } from '../../../../../services/ActionManager/contracts/IActionManager.js';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import { BrudToolsToken } from '../../../../../services/BrudTools/descriptor/tokens.js';
import { createTerminalPlugin } from '../../plugin.js';
import {
  TERMINAL_KILL_PROCESS_ACTION,
  TERMINAL_LIST_PROCESSES_ACTION,
} from './terminalActions.js';
import type { TerminalProcessInfo } from './terminalActions.js';

interface Harness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly actions: IActionManager;
  readonly tools: IBrudToolsService;
  readonly actionContext: IActionExecutionContext;
  readonly toolContext: IPluginExecutionContext;
  shutdown(): Promise<void>;
}

interface ListData {
  readonly processes: readonly TerminalProcessInfo[];
}

async function bootKernel(): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-terminal-actions-')));
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [createTerminalPlugin()],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const caller = { callerId: 'test.terminal.actions', tier: 'core' as const, workspaceRoot: root };
  const actionCaller = {
    callerId: ACTION_MANAGER_DAEMON_CALLER_ID,
    tier: 'core' as const,
    workspaceRoot: root,
  };
  let actions: IActionManager;
  let tools: IBrudToolsService;

  try {
    actions = kernel.requestAccess(actionCaller, ActionManagerToken);
    tools = kernel.requestAccess(caller, BrudToolsToken);
  } catch (error: unknown) {
    await kernel.shutdown();
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    kernel,
    root,
    actions,
    tools,
    actionContext: {
      workspaceRoot: root,
      callerId: 'c_ui',
      origin: 'daemon-rpc',
    },
    toolContext: {
      workspaceRoot: root,
      callerId: 'test.terminal.actions',
    },
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

async function waitForProcess(harness: Harness, expected: number): Promise<readonly TerminalProcessInfo[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await harness.actions.executeAction(
      TERMINAL_LIST_PROCESSES_ACTION,
      {},
      harness.actionContext,
    );

    const processes = (result.data as ListData | undefined)?.processes ?? [];

    if (processes.length >= expected) {
      return processes;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${expected} terminal process(es)`);
}

describe('terminal actions', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await bootKernel();
  });

  afterEach(async () => {
    await harness?.shutdown();
  });

  it('registers both terminal actions through the plugin manager', () => {
    const names = harness.actions.listActions().map((action) => action.name);

    assert.ok(names.includes(TERMINAL_KILL_PROCESS_ACTION));
    assert.ok(names.includes(TERMINAL_LIST_PROCESSES_ACTION));

    const owned = harness.actions
      .listActions()
      .filter((action) => action.ownerPluginId === 'akkhar-labs.plugin.terminal');

    assert.deepEqual(
      owned.map((action) => action.name).sort(),
      [TERMINAL_KILL_PROCESS_ACTION, TERMINAL_LIST_PROCESSES_ACTION].sort(),
    );
  });

  it('lists an empty process set and rejects unknown input properties', async () => {
    const listed = await harness.actions.executeAction(
      TERMINAL_LIST_PROCESSES_ACTION,
      {},
      harness.actionContext,
    );

    assert.equal(listed.status, 'success');
    assert.deepEqual((listed.data as ListData).processes, []);

    const rejected = await harness.actions.executeAction(
      TERMINAL_LIST_PROCESSES_ACTION,
      { unexpected: true },
      harness.actionContext,
    );

    assert.equal(rejected.status, 'failed');
    assert.match(String(rejected.error), /ACTION_VALIDATION_ERROR/u);
  });

  it('refuses to kill a process this plugin does not own', async () => {
    const result = await harness.actions.executeAction(
      TERMINAL_KILL_PROCESS_ACTION,
      { processId: 'proc-does-not-exist' },
      harness.actionContext,
    );

    assert.equal(result.status, 'failed');
    assert.equal(String(result.error), 'TERMINAL_PROCESS_NOT_FOUND');
  });

  it(
    'kills a live process started through the terminal tool',
    { timeout: 20000 },
    async () => {
      const running = harness.tools.executeTool(
        'terminal_command',
        { command: 'sleep 30', timeout: 60 },
        harness.toolContext,
      );

      const processes = await waitForProcess(harness, 1);
      const target = processes[0];

      assert.ok(target !== undefined);

      const killed = await harness.actions.executeAction(
        TERMINAL_KILL_PROCESS_ACTION,
        { processId: target.processId },
        harness.actionContext,
      );

      assert.equal(killed.status, 'success');
      assert.equal((killed.data as TerminalProcessInfo).processId, target.processId);

      const toolResult: OperationResult = await running;

      assert.equal(toolResult.status, 'aborted');

      const remaining = await harness.actions.executeAction(
        TERMINAL_LIST_PROCESSES_ACTION,
        {},
        harness.actionContext,
      );

      assert.deepEqual((remaining.data as ListData).processes, []);
    },
  );
});
