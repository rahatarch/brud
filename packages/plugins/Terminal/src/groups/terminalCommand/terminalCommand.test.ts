import { workspaceContextOptions } from '../../../../../kernel/src/__tests__/support/workspaceContext.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { terminalCommand } from './terminalCommand.js';

interface Harness {
  readonly kernel: BrudKernel;
  readonly root: string;
  readonly tools: IBrudToolsService;
  readonly caller: IPluginExecutionContext;
  shutdown(): Promise<void>;
}

interface CommandData {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly duration: number;
  readonly success: boolean;
}

interface GroupData {
  readonly code: string;
  readonly results: readonly CommandData[];
}

async function bootKernel(): Promise<Harness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-terminal-')));
  const kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [createTerminalPlugin()],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });

  const caller: IPluginExecutionContext = {
    workspaceRoot: root,
    callerId: 'test.terminal',
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

function run(
  harness: Harness,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OperationResult> {
  return harness.tools.executeTool('terminal_command', input, {
    ...harness.caller,
    ...(signal === undefined ? {} : { signal }),
  });
}

function groupData(result: OperationResult): GroupData {
  return result.data as GroupData;
}

function successGroupData(result: OperationResult): readonly CommandData[] {
  return result.data as readonly CommandData[];
}

function commandData(result: OperationResult): CommandData {
  return result.data as CommandData;
}

function resultCode(result: OperationResult): string | undefined {
  return (result as OperationResult & { readonly code?: string }).code;
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

async function collectRuntimeSources(directory: string): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<{ file: string; source: string }> = [];

  for (const entry of entries) {
    const absolute = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }

      files.push(...await collectRuntimeSources(absolute));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push({ file: absolute, source: await readFile(absolute, 'utf8') });
    }
  }

  return files;
}

describe('terminal_command', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await bootKernel();
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it('executes a single command and reports its output', { timeout: 15000 }, async () => {
    const result = await run(harness, { command: 'echo hello' });

    assert.equal(result.status, 'success');
    assert.match(result.message ?? '', /Terminal command executed successfully/);
    assert.match(result.message ?? '', /hello/);
    assert.equal(commandData(result).exitCode, 0);
    assert.match(commandData(result).output, /hello/);
  });

  it('reports a non-zero single command as EXECUTION_FAILED', { timeout: 15000 }, async () => {
    const result = await run(harness, { command: 'exit 1' });

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'EXECUTION_FAILED');
    assert.match(result.message ?? '', /Terminal command failed \(exit code: 1\)/);
    assert.equal(commandData(result).exitCode, 1);
  });

  it('stops a sequential batch at the first failure when stopOnFailure is true', { timeout: 15000 }, async () => {
    const result = await run(harness, {
      commands: ['echo first', 'exit 1', 'echo third'],
      stopOnFailure: true,
    });

    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Executed 2 commands\. 1 succeeded, 1 failed\./);
    assert.deepEqual(groupData(result).results.map((entry) => entry.command), ['echo first', 'exit 1']);
  });

  it('continues a sequential batch when stopOnFailure is false', { timeout: 15000 }, async () => {
    const result = await run(harness, {
      commands: ['exit 1', 'echo second'],
      stopOnFailure: false,
    });

    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Executed 2 commands\. 1 succeeded, 1 failed\./);
    assert.equal(groupData(result).results.length, 2);
    assert.equal(groupData(result).results[1]?.success, true);
    assert.match(groupData(result).results[1]?.output ?? '', /second/);
  });

  it('preserves command order in a parallel batch', { timeout: 15000 }, async () => {
    const result = await run(harness, {
      commands: ['echo first', 'echo second'],
      mode: 'parallel',
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      successGroupData(result).map((entry) => entry.command),
      ['echo first', 'echo second'],
    );
    assert.match(successGroupData(result)[0]?.output ?? '', /first/);
    assert.match(successGroupData(result)[1]?.output ?? '', /second/);
  });

  it('runs the onSuccess branch after a successful conditional command', { timeout: 15000 }, async () => {
    const result = await run(harness, {
      command: 'echo primary',
      onSuccess: 'echo branch',
    });

    assert.equal(result.status, 'success');
    assert.match(result.message ?? '', /Executed conditional command\. 2 succeeded, 0 failed\./);
    assert.deepEqual(
      successGroupData(result).map((entry) => entry.command),
      ['echo primary', 'echo branch'],
    );
  });

  it('runs the onFailure branch after a failed conditional command', { timeout: 15000 }, async () => {
    const result = await run(harness, {
      command: 'exit 1',
      onFailure: 'echo recovered',
    });

    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Executed conditional command\. 1 succeeded, 1 failed\./);
    assert.deepEqual(
      groupData(result).results.map((entry) => entry.command),
      ['exit 1', 'echo recovered'],
    );
    assert.match(groupData(result).results[1]?.output ?? '', /recovered/);
  });

  it('maps a timeout onto TERMINAL_TIMEOUT', { timeout: 15000 }, async () => {
    const started = Date.now();
    const result = await run(harness, { command: 'sleep 5', timeout: 1 });
    const elapsed = Date.now() - started;

    assert.ok(elapsed >= 900, `expected the timeout to take about a second, took ${elapsed}ms`);
    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'TERMINAL_TIMEOUT');
  });

  it('maps an aborted run onto TERMINAL_INTERRUPTED', { timeout: 15000 }, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);

    try {
      const result = await run(
        harness,
        { command: 'sleep 5', timeout: 10 },
        controller.signal,
      );

      assert.equal(result.status, 'aborted');
      assert.equal(resultCode(result), 'TERMINAL_INTERRUPTED');
    } finally {
      clearTimeout(timer);
    }
  });

  it('converts seconds to milliseconds before calling the terminal handle', async () => {
    const terminal = fakeTerminal();

    await terminalCommand({ command: 'echo hi', timeout: 2 }, terminal, harness.caller);
    await terminalCommand({ command: 'echo hi' }, terminal, harness.caller);

    assert.equal(terminal.calls[0]?.timeoutMs, 2000);
    assert.equal(terminal.calls[1]?.timeoutMs, 120000);
  });

  it('defaults stopOnFailure to true for a sequential batch', async () => {
    const terminal = fakeTerminal();

    await terminalCommand(
      { commands: ['echo one', 'echo two'] },
      terminal,
      harness.caller,
    );

    assert.equal(terminal.calls[0]?.stopOnFailure, true);
  });

  it('forwards cwd and env to the terminal handle', async () => {
    const terminal = fakeTerminal();

    await terminalCommand(
      { command: 'echo hi', cwd: 'sub/dir', env: { TERMINAL_TEST_ENV: '1' } },
      terminal,
      harness.caller,
    );

    assert.equal(terminal.calls[0]?.cwd, 'sub/dir');
    assert.deepEqual(terminal.calls[0]?.env, { TERMINAL_TEST_ENV: '1' });
  });

  it('forwards cwd and env for batch and conditional requests', async () => {
    const terminal = fakeTerminal();
    const options = { cwd: 'sub/dir', env: { TERMINAL_TEST_ENV: '1' } };

    await terminalCommand({ commands: ['echo one'], ...options }, terminal, harness.caller);
    await terminalCommand(
      { command: 'echo one', onSuccess: 'echo two', ...options },
      terminal,
      harness.caller,
    );

    assert.equal(terminal.calls[0]?.mode, 'sequential');
    assert.equal(terminal.calls[0]?.cwd, 'sub/dir');
    assert.deepEqual(terminal.calls[0]?.env, { TERMINAL_TEST_ENV: '1' });
    assert.equal(terminal.calls[1]?.mode, 'conditional');
    assert.equal(terminal.calls[1]?.cwd, 'sub/dir');
    assert.deepEqual(terminal.calls[1]?.env, { TERMINAL_TEST_ENV: '1' });
  });

  it('accepts cwd and env at the schema gate and still rejects unknown properties', async () => {
    const accepted = await run(harness, {
      command: 'echo hello',
      cwd: harness.root,
      env: { TERMINAL_TEST_ENV: '1' },
    });

    assert.equal(accepted.status, 'success');
    assert.match(commandData(accepted).output, /hello/);

    const rejected = await run(harness, { command: 'echo hello', unexpected: true });

    assert.equal(rejected.status, 'failed');
    assert.match(String(rejected.error), /TOOL_VALIDATION_ERROR/);
  });

  it('runs the command in the requested cwd and with the requested env', { timeout: 15000 }, async () => {
    const subdir = join(harness.root, 'subdir');
    await mkdir(subdir, { recursive: true });

    const result = await run(harness, {
      commands: ['pwd', 'printenv TERMINAL_TEST_ENV'],
      cwd: subdir,
      env: { TERMINAL_TEST_ENV: 'forwarded' },
    });

    assert.equal(result.status, 'success');

    const outputs = successGroupData(result).map((entry) => entry.output);

    assert.match(outputs[0] ?? '', /subdir/);
    assert.match(outputs[1] ?? '', /forwarded/);
  });

  it('does not import child_process or any node:* module in runtime source', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sourceRoot = resolve(here, '../../..');
    const files = await collectRuntimeSources(sourceRoot);

    assert.ok(files.length > 0, 'expected runtime TypeScript sources to scan');

    for (const { file, source } of files) {
      assert.equal(source.includes('child_process'), false, `${file} imports child_process`);
      assert.equal(
        /\bfrom\s+['"]node:|\bimport\s*\(\s*['"]node:|\brequire\s*\(\s*['"]node:/.test(source),
        false,
        `${file} imports a node:* module`,
      );
      assert.equal(
        /\bfrom\s+['"](?:net|http|https|http2|tls|dgram)['"]/.test(source),
        false,
        `${file} imports a bare network module`,
      );
    }
  });
});
