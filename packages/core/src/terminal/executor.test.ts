import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { executeTerminalCommand } from './executor.js';

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
});