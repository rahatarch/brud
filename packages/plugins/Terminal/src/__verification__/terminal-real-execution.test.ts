/**
 * Goal 1 — Real terminal execution.
 *
 * Every test runs a real `/bin/sh` child through the real kernel terminal
 * service. No process API is mocked and no output is synthesised.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootTerminalHarness,
  errorText,
  failureOutput,
  groupData,
  resultCode,
  singleData,
} from './support/harness.test.js';
import type { TerminalHarness } from './support/harness.test.js';

const LONG_OUTPUT_BYTES = 8 * 1024 * 1024;

let harness: TerminalHarness;

before(async () => {
  harness = await bootTerminalHarness({ prefix: 'brud-terminal-real-' });
});

after(async () => {
  await harness.shutdown();
});

describe('Goal 1 — terminal_command real execution', () => {
  it('spawns echo hello and returns real stdout with exit code 0', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: 'echo hello' });

    assert.equal(result.status, 'success');
    assert.match(singleData(result).output, /hello/u);
    assert.equal(singleData(result).exitCode, 0);
    assert.equal(singleData(result).success, true);
  });

  it('reports exit 1 as a real non-zero failure', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: 'exit 1' });

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'EXECUTION_FAILED');
    assert.equal(singleData(result).exitCode, 1);
    assert.match(result.message ?? '', /exit code: 1/u);
  });

  it('preserves newlines from printf', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: "printf 'a\\nb\\nc\\n'" });

    assert.equal(result.status, 'success');
    assert.equal(singleData(result).output, 'a\nb\nc\n');
  });

  it('captures stderr in the measured transcript', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: 'echo err 1>&2; echo out' });

    assert.equal(result.status, 'success');
    assert.match(singleData(result).output, /err/u);
    assert.match(singleData(result).output, /out/u);
  });

  it('runs a sequential batch in declaration order', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      commands: ["printf 'one\\n'", "printf 'two\\n'", "printf 'three\\n'"],
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      groupData(result).map((entry) => entry.output),
      ['one\n', 'two\n', 'three\n'],
    );
    assert.deepEqual(
      groupData(result).map((entry) => entry.command),
      ["printf 'one\\n'", "printf 'two\\n'", "printf 'three\\n'"],
    );
  });

  it('runs a parallel batch and preserves the requested result order', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      commands: ["printf 'first\\n'", "printf 'second\\n'"],
      mode: 'parallel',
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      groupData(result).map((entry) => entry.output),
      ['first\n', 'second\n'],
    );
  });

  it('stops a sequential batch at the first failure when stopOnFailure is true', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      commands: ['echo first', 'exit 1', 'echo third'],
      stopOnFailure: true,
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(
      groupData(result).map((entry) => entry.command),
      ['echo first', 'exit 1'],
    );
  });

  it('continues after a failure when stopOnFailure is false', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      commands: ['exit 1', 'echo second'],
      stopOnFailure: false,
    });

    assert.equal(result.status, 'failed');
    assert.equal(groupData(result).length, 2);
    assert.equal(groupData(result)[1]?.success, true);
    assert.match(groupData(result)[1]?.output ?? '', /second/u);
  });

  it('runs the onSuccess branch when the primary command succeeds', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      command: 'echo primary',
      onSuccess: 'echo branch',
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(
      groupData(result).map((entry) => entry.command),
      ['echo primary', 'echo branch'],
    );
  });

  it('runs the onFailure branch when the primary command fails', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      command: 'exit 1',
      onFailure: 'echo recovered',
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(
      groupData(result).map((entry) => entry.command),
      ['exit 1', 'echo recovered'],
    );
    assert.match(groupData(result)[1]?.output ?? '', /recovered/u);
  });

  it('does not run the onSuccess branch when the primary command fails', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      command: 'exit 1',
      onSuccess: 'echo should-not-run',
    });

    assert.equal(result.status, 'failed');
    assert.equal(
      groupData(result).some((entry) => /should-not-run/u.test(entry.output)),
      false,
    );
  });
});

describe('Goal 1 — terminal_interactive real stdin', () => {
  it('feeds one answer to a real long-running Node process', { timeout: 20_000 }, async () => {
    const script = 'process.stdin.on("data",(chunk)=>{process.stdout.write("got:"+chunk.toString().trim());process.exit(0);});';
    const result = await harness.execute('terminal_interactive', {
      command: `node -e '${script}'`,
      answers: ['hello'],
    });

    assert.equal(result.status, 'success');
    assert.match(singleData(result).output, /got:hello/u);
  });

  it('feeds multiple answers in order', { timeout: 25_000 }, async () => {
    const script = 'const rl=require("readline").createInterface({input:process.stdin});const a=[];rl.on("line",(l)=>{a.push(l);if(a.length===3){console.log(a.join("|"));rl.close();}});';
    const result = await harness.execute('terminal_interactive', {
      command: `node -e '${script}'`,
      answers: ['one', 'two', 'three'],
      timeout: 10,
    });

    assert.equal(result.status, 'success');
    assert.match(singleData(result).output, /one\|two\|three/u);
  });

  it('truncates a 10,000-line runaway producer at the documented 8 MiB ceiling', { timeout: 40_000 }, async () => {
    const script = 'const s="x".repeat(2000);for(let i=0;i<10000;i++)console.log(s);';
    const result = await harness.run({ command: `node -e '${script}'`, timeout: 30 });

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'TERMINAL_OUTPUT_LIMIT');
    const output = failureOutput(result);

    assert.match(output, /output truncated/u);
    const bytes = Buffer.byteLength(output, 'utf8');
    assert.ok(bytes >= LONG_OUTPUT_BYTES, `retained output must reach the ceiling, got ${bytes}`);
    assert.ok(bytes <= LONG_OUTPUT_BYTES + 200, `retained output must stop at the ceiling, got ${bytes}`);
  });
});

describe('Goal 1 — payload validation', () => {
  it('rejects an empty command without spawning', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: '' });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /requires either "command" or a non-empty "commands"/u);
  });

  it('prefers commands[] over a simultaneously supplied command', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      command: 'echo single',
      commands: ['echo batch'],
    });

    assert.equal(result.status, 'success');
    assert.equal(groupData(result).length, 1);
    assert.equal(groupData(result)[0]?.command, 'echo batch');
    assert.doesNotMatch(groupData(result)[0]?.output ?? '', /single/u);
  });

  it('rejects a commands[] entry that is not a string', { timeout: 20_000 }, async () => {
    const result = await harness.run({ commands: ['echo ok', 42] });

    assert.equal(result.status, 'failed');
    assert.match(errorText(result), /commands/u);
  });
});