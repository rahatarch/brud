import { workspaceContextOptions } from '../../../../../kernel/src/__tests__/support/workspaceContext.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
  ITerminalHandle,
  OperationResult,
  TerminalResult,
  TerminalRunRequest,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import { BrudToolsToken } from '../../../../../kernel/services/BrudTools/descriptor/tokens.js';
import { createTerminalPlugin } from '../../plugin.js';
import { terminalInteractive } from './terminalInteractive.js';

interface Harness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly tools: IBrudToolsService;
  readonly caller: IPluginExecutionContext;
  shutdown(): Promise<void>;
}

interface InteractiveData {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly success: boolean;
}

async function bootKernel(): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-terminal-interactive-')));
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [createTerminalPlugin()],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const caller: IPluginExecutionContext = {
    workspaceRoot: root,
    callerId: 'test.terminal.interactive',
  };
  const tools = kernel.requestAccess(
    { callerId: caller.callerId, tier: 'core', workspaceRoot: root },
    BrudToolsToken,
  );

  return {
    kernel,
    root,
    tools,
    caller,
    shutdown: async (): Promise<void> => {
      try {
        await kernel.shutdown();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

function run(harness: Harness, input: Record<string, unknown>): Promise<OperationResult> {
  return harness.tools.executeTool('terminal_interactive', input, harness.caller);
}

function resultCode(result: OperationResult): string | undefined {
  return (result as OperationResult & { readonly code?: string }).code;
}

function errorText(result: OperationResult): string {
  return typeof result.error === 'string'
    ? result.error
    : result.error instanceof Error
      ? result.error.message
      : '';
}

const SUCCESS_RESULT: TerminalResult = {
  success: true,
  output: 'ok',
  exitCode: 0,
  duration: 1,
  status: 'success',
};

function fakeTerminal(): ITerminalHandle & { readonly calls: TerminalRunRequest[] } {
  const calls: TerminalRunRequest[] = [];

  return {
    calls,
    async run(request: TerminalRunRequest): Promise<TerminalResult> {
      calls.push(request);

      return SUCCESS_RESULT;
    },
    async cancel(): Promise<void> {},
    list(): readonly [] {
      return [];
    },
    async dispose(): Promise<void> {},
  };
}

describe('terminal_interactive', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await bootKernel();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it('feeds answers to a real interactive process', { timeout: 15000 }, async () => {
    const script = "process.stdin.on('data',(chunk)=>{process.stdout.write('got:'+chunk.toString().trim());process.exit(0);});";
    const result = await run(harness, {
      command: `node -e "${script}"`,
      answers: ['hello'],
    });

    assert.equal(result.status, 'success');
    assert.match(result.message ?? '', /Terminal command executed successfully/);
    assert.match((result.data as InteractiveData).output, /got:hello/);
  });

  it('maps an unanswered interactive process timeout onto TERMINAL_TIMEOUT', { timeout: 15000 }, async () => {
    const result = await run(harness, {
      command: 'sleep 5',
      answers: ['not-an-answer'],
      timeout: 1,
    });

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'TERMINAL_TIMEOUT');
  });

  it('rejects a payload without answers at the schema gate', async () => {
    const result = await run(harness, { command: 'echo hello' });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /TOOL_VALIDATION_ERROR/);
  });

  it('rejects a payload without a command at the schema gate', async () => {
    const result = await run(harness, { answers: ['hello'] });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /TOOL_VALIDATION_ERROR/);
  });

  it('forwards cwd and env to the terminal handle', async () => {
    const terminal = fakeTerminal();

    await terminalInteractive(
      { command: 'cat', answers: ['hello'], cwd: 'sub/dir', env: { TERMINAL_TEST_ENV: '1' } },
      terminal,
      harness.caller,
    );

    assert.equal(terminal.calls[0]?.mode, 'interactive');
    assert.equal(terminal.calls[0]?.cwd, 'sub/dir');
    assert.deepEqual(terminal.calls[0]?.env, { TERMINAL_TEST_ENV: '1' });
    assert.deepEqual(terminal.calls[0]?.answers, ['hello']);
  });

  it('accepts cwd and env at the schema gate and still rejects unknown properties', async () => {
    const script = "process.stdin.on('data',(chunk)=>{process.stdout.write('got:'+chunk.toString().trim());process.exit(0);});";
    const accepted = await run(harness, {
      command: `node -e "${script}"`,
      answers: ['hello'],
      cwd: harness.root,
      env: { TERMINAL_TEST_ENV: '1' },
    });

    assert.equal(accepted.status, 'success');
    assert.match((accepted.data as InteractiveData).output, /got:hello/);

    const rejected = await run(harness, {
      command: 'echo hello',
      answers: [],
      unexpected: true,
    });

    assert.equal(rejected.status, 'failed');
    assert.match(errorText(rejected), /TOOL_VALIDATION_ERROR/);
  });
});
