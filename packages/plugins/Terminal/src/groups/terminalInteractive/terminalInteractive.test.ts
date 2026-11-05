import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
  OperationResult,
} from '@brud/kernel';
import { createStandardKernel } from '../../../../../kernel/src/bootstrap/index.js';
import type { BrudKernel } from '../../../../../kernel/src/engine/BrudKernel.js';
import { BrudToolsToken } from '../../../../../kernel/services/BrudTools/descriptor/tokens.js';
import { createTerminalPlugin } from '../../plugin.js';

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

  await kernel.boot({ workspaceRoot: root });

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
});