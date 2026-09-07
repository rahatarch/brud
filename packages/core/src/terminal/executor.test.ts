import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional, executeCommandGroup } from './executor.js';
import type { ConditionalCommand, CommandGroup } from './types.js';

describe('Terminal Executor', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp('/tmp/brud-executor-test-');
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('Test 1: Simple command execution', async () => {
    const result = await executeTerminalCommand('echo hello', []);
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('hello'));
    assert.strictEqual(result.exitCode, 0);
  });

  it('Test 2: Command with arguments', async () => {
    const result = await executeTerminalCommand('node --version', []);
    assert.strictEqual(result.success, true);
    assert.ok(result.output.trim().length > 0);
    assert.strictEqual(result.exitCode, 0);
  });

  it('Test 3: Interactive command with answers', async () => {
    const scriptPath = path.join(tempDir, 'ask_name.sh');
    await fs.writeFile(scriptPath, `#!/bin/bash
printf "What is your name?"
read name
echo "Hello, $name!"
`);
    await fs.chmod(scriptPath, 0o755);
    const result = await executeTerminalCommand(`bash ${scriptPath}`, ['Brud'], tempDir, 10000);
    assert.ok(result.output.includes('Hello, Brud!'), `output: ${result.output}`);
  });

  it('Test 4: Multiple answers', async () => {
    const scriptPath = path.join(tempDir, 'ask_three.sh');
    await fs.writeFile(scriptPath, `#!/bin/bash
printf "Question 1:"
read ans1
printf "Question 2:"
read ans2
printf "Question 3:"
read ans3
echo "Answers: $ans1 $ans2 $ans3"
`);
    await fs.chmod(scriptPath, 0o755);
    const result = await executeTerminalCommand(`bash ${scriptPath}`, ['one', 'two', 'three'], tempDir, 15000);
    assert.ok(result.output.includes('Answers: one two three'), `output: ${result.output}`);
  });

  it('Test 5: Timeout handling', async () => {
    const result = await executeTerminalCommand('sleep 30', [], undefined, 2000);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, null);
  });

  it('Test 6: Failed command', async () => {
    const result = await executeTerminalCommand('ls /nonexistent/path', []);
    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.exitCode, 0);
    assert.notStrictEqual(result.exitCode, null);
  });

  it('Test 7: ANSI stripping', async () => {
    const result = await executeTerminalCommand(`echo -e "\\x1b[31mRed text\\x1b[0m"`, []);
    assert.ok(!result.output.includes('\x1b'), `output contained escape codes: ${JSON.stringify(result.output)}`);
    assert.ok(result.output.includes('Red text'), `output: ${result.output}`);
  });

  it('Test 8: Working directory', async () => {
    const result = await executeTerminalCommand('pwd', [], tempDir);
    assert.ok(result.output.includes(tempDir), `expected ${tempDir} in output: ${result.output}`);
  });

  it('TEST 1: Timeout kills long-running command', async () => {
    const start = Date.now();
    const result = await executeCommand('sleep 30', undefined, 2000);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 10000, `Expected completion in < 10000ms, got ${elapsed}ms`);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, null);
  });

  it('TEST 2: Process is actually dead after timeout', { skip: process.platform === 'win32' }, async () => {
    const pidFile = path.join(tempDir, 'timeout_pid.txt');
    const result = await executeCommand(`echo $$ > "${pidFile}"; exec sleep 30`, undefined, 2000);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, null);
    const contents = await fs.readFile(pidFile, 'utf-8');
    const pid = parseInt(contents.trim(), 10);
    assert.ok(Number.isInteger(pid) && pid > 0, `Invalid PID from file: ${contents.trim()}`);
    assert.throws(
      () => process.kill(pid, 0),
      (err: unknown) => (err as NodeJS.ErrnoException).code === 'ESRCH',
    );
  });

  it('TEST 3: Grace period kills process that ignores SIGTERM', async () => {
    const start = Date.now();
    const result = await executeCommand('trap "" TERM; sleep 30', undefined, 1000);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 12000, `Expected completion in < 12000ms, got ${elapsed}ms`);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, null);
  });

  it('TEST 4: Normal command still works with timeout', async () => {
    const start = Date.now();
    const result = await executeCommand('echo hello', undefined, 5000);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 3000, `Expected completion in < 3000ms, got ${elapsed}ms`);
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('hello'));
  });

  describe('executeCommand', () => {
    it('succeeds with echo', async () => {
      const result = await executeCommand('echo hello world');
      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes('hello world'));
      assert.strictEqual(result.exitCode, 0);
    });

    it('fails with nonexistent path', async () => {
      const result = await executeCommand('ls /nonexistent');
      assert.strictEqual(result.success, false);
      assert.notStrictEqual(result.exitCode, 0);
      assert.notStrictEqual(result.exitCode, null);
    });
  });

  describe('executeSequential', () => {
    it('executes 2 commands in order', async () => {
      const result = await executeSequential(['echo first', 'echo second']);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.results.length, 2);
      assert.ok(result.results[0].output.includes('first'));
      assert.ok(result.results[1].output.includes('second'));
    });

    it('stops on failure with stopOnFailure', async () => {
      const result = await executeSequential(['ls /nonexistent', 'echo should_not_run'], undefined, 5000, undefined, true);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.results.length, 1);
    });
  });

  describe('executeParallel', () => {
    it('executes 2 commands in parallel', async () => {
      const result = await executeParallel(['echo parallel_a', 'echo parallel_b']);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.results.length, 2);
      const outputs = result.results.map(r => r.output);
      assert.ok(outputs.some(o => o.includes('parallel_a')));
      assert.ok(outputs.some(o => o.includes('parallel_b')));
    });
  });

  describe('executeConditional', () => {
    it('runs onSuccess when primary command succeeds', async () => {
      const conditional: ConditionalCommand = {
        command: 'echo ok',
        onSuccess: { type: 'sequential', commands: ['echo success_handler'] },
      };
      const result = await executeConditional(conditional);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.results.length, 2);
      assert.ok(result.results[1].output.includes('success_handler'));
    });

    it('runs onFailure when primary command fails', async () => {
      const conditional: ConditionalCommand = {
        command: 'ls /nonexistent',
        onFailure: { type: 'sequential', commands: ['echo failure_handler'] },
      };
      const result = await executeConditional(conditional);
      assert.strictEqual(result.results[0].success, false);
      assert.strictEqual(result.results.length, 2);
      assert.ok(result.results[1].output.includes('failure_handler'));
    });
  });

  describe('executeCommandGroup (nested)', () => {
    it('handles mixed nested groups', async () => {
      const group: CommandGroup = {
        type: 'sequential',
        commands: [
          'echo outer_first',
          {
            type: 'parallel',
            commands: ['echo inner_parallel_a', 'echo inner_parallel_b'],
          },
          'echo outer_last',
        ],
      };
      const result = await executeCommandGroup(group);
      assert.strictEqual(result.results.length, 4);
      assert.ok(result.results[0].output.includes('outer_first'));
      assert.ok(result.results[1].output.includes('outer_last'));
      const outputs = result.results.map(r => r.output);
      assert.ok(outputs.some(o => o.includes('inner_parallel_a')));
      assert.ok(outputs.some(o => o.includes('inner_parallel_b')));
    });
  });
});