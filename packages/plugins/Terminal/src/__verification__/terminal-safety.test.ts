/**
 * Goal 2 — Terminal governor and safety boundaries.
 *
 * Timeouts, abort, output ceilings, containment, environment sanitation and
 * process-tree cleanup are exercised against real children, not fakes.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bootTerminalHarness,
  errorText,
  failureOutput,
  resultCode,
  singleData,
} from './support/harness.test.js';
import type { TerminalHarness } from './support/harness.test.js';

const OUTPUT_CAP_BYTES = 8 * 1024 * 1024;

let harness: TerminalHarness;

before(async () => {
  harness = await bootTerminalHarness({ prefix: 'brud-terminal-safety-' });
  await mkdir(join(harness.root, 'src'), { recursive: true });
});

after(async () => {
  await harness.shutdown();
});

interface PsEntry {
  readonly pid: number;
  readonly args: string;
}

/** Lists live processes and their argument vectors. */
async function liveProcesses(): Promise<readonly PsEntry[]> {
  const result = await harness.run({ command: 'ps -eo pid=,args=' });

  assert.equal(result.status, 'success', errorText(result));

  return singleData(result).output
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/u.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ pid: Number(match[1]), args: match[2] ?? '' }));
}

async function tokenStillAlive(token: string): Promise<boolean> {
  const entries = await liveProcesses();

  return entries.some((entry) => entry.args.includes(token));
}

describe('Goal 2 — timeout and abort', () => {
  it('kills a command that exceeds its timeout and reports TERMINAL_TIMEOUT', { timeout: 20_000 }, async () => {
    const started = Date.now();
    const result = await harness.run({ command: 'sleep 10', timeout: 1 });
    const elapsed = Date.now() - started;

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'TERMINAL_TIMEOUT');
    assert.ok(elapsed < 8_000, `timeout must not wait for the child, took ${elapsed}ms`);
  });

  it('leaves no orphan process behind after a timeout', { timeout: 25_000 }, async () => {
    const token = `brud-orphan-${randomUUID()}`;
    const script = `setTimeout(()=>{},10000);/*${token}*/`;
    const result = await harness.run({
      command: `node -e '${script}'`,
      timeout: 1,
    });

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'TERMINAL_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await tokenStillAlive(token), false, `orphan ${token} survived the timeout`);
  });

  it('maps an abort signal onto TERMINAL_INTERRUPTED', { timeout: 20_000 }, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);

    try {
      const result = await harness.run({ command: 'sleep 10', timeout: 20 }, controller.signal);

      assert.equal(result.status, 'aborted');
      assert.equal(resultCode(result), 'TERMINAL_INTERRUPTED');
    } finally {
      clearTimeout(timer);
    }
  });

  it('cleans up a spawning tree when the request is aborted', { timeout: 25_000 }, async () => {
    const token = `brud-tree-${randomUUID()}`;
    const childScript = `setTimeout(()=>{},10000);/*${token}*/`;
    const parentScript = `require("child_process").spawn(process.execPath,["-e",${JSON.stringify(childScript)}],{stdio:"ignore"});setTimeout(()=>{},10000);/*${token}*/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);

    try {
      const result = await harness.run(
        { command: `node -e '${parentScript}'`, timeout: 20 },
        controller.signal,
      );

      assert.equal(resultCode(result), 'TERMINAL_INTERRUPTED');
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(await tokenStillAlive(token), false, `descendant ${token} survived abort`);
    } finally {
      clearTimeout(timer);
    }
  });

  it('uses SIGTERM before the forced kill so a term-trapping shell gets a grace window', { timeout: 25_000 }, async () => {
    const graceHarness = await bootTerminalHarness({
      prefix: 'brud-terminal-grace-',
      policy: { killGraceMs: 400 },
    });
    const controller = new AbortController();
    const started = Date.now();
    const timer = setTimeout(() => controller.abort(), 500);

    try {
      const result = await graceHarness.run(
        { command: "trap '' TERM; sleep 10", timeout: 20 },
        controller.signal,
      );
      const elapsed = Date.now() - started;

      assert.equal(resultCode(result), 'TERMINAL_INTERRUPTED');
      assert.ok(elapsed >= 700, `expected the SIGTERM grace window, took ${elapsed}ms`);
    } finally {
      clearTimeout(timer);
      await graceHarness.shutdown();
    }
  });
});

describe('Goal 2 — output ceiling', () => {
  it('stops a 9 MB producer at the documented 8 MiB cap', { timeout: 30_000 }, async () => {
    const result = await harness.run({
      command: "head -c 9000000 /dev/zero | tr '\\0' x",
      timeout: 20,
    });

    assert.equal(result.status, 'failed');
    assert.equal(resultCode(result), 'TERMINAL_OUTPUT_LIMIT');
    const output = failureOutput(result);

    assert.match(output, /output truncated/u);
    assert.ok(Buffer.byteLength(output) <= OUTPUT_CAP_BYTES + 200);
  });
});

describe('Goal 2 — working-directory containment', () => {
  it('refuses a shell cd that escapes the workspace', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: 'cd ../../../etc && ls' });

    assert.equal(result.status, 'failed');
    assert.match(
      errorText(result),
      /outside the current workspace|CWD_ESCAPE/u,
    );
  });

  it('allows a cd that stays inside the workspace', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: 'cd src && pwd' });

    assert.equal(result.status, 'success');
    assert.equal(singleData(result).output.trim(), join(harness.root, 'src'));
  });
});

describe('Goal 2 — environment sanitation', () => {
  it('does not inherit an env var outside the allowlist', { timeout: 20_000 }, async () => {
    process.env.MY_SECRET_PROBE = 'leaked-to-child';

    try {
      const result = await harness.run({
        command: "node -e 'process.stdout.write(process.env.MY_SECRET_PROBE||\"<empty>\")'",
      });

      assert.equal(result.status, 'success');
      assert.equal(singleData(result).output, '<empty>');
    } finally {
      delete process.env.MY_SECRET_PROBE;
    }
  });
});

describe('Goal 2 — concurrency and shell semantics', () => {
  it('runs two commands in parallel without cross-contamination', { timeout: 20_000 }, async () => {
    const [left, right] = await Promise.all([
      harness.run({ command: 'sleep 0.2; echo LEFT' }),
      harness.run({ command: 'sleep 0.2; echo RIGHT' }),
    ]);

    assert.equal(left.status, 'success');
    assert.equal(right.status, 'success');
    assert.equal(singleData(left).output.trim(), 'LEFT');
    assert.equal(singleData(right).output.trim(), 'RIGHT');
  });

  it('allows shell metacharacters in non-interactive commands', { timeout: 20_000 }, async () => {
    const result = await harness.run({
      command: "printf 'a'; printf 'b' && printf 'c' | tr 'c' 'C'",
    });

    assert.equal(result.status, 'success');
    assert.equal(singleData(result).output, 'abC');
  });

  it('treats empty output as a successful command', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: 'true' });

    assert.equal(result.status, 'success');
    assert.equal(singleData(result).output, '');
    assert.equal(singleData(result).exitCode, 0);
  });

  it('replaces non-UTF8 bytes with U+FFFD', { timeout: 20_000 }, async () => {
    const result = await harness.run({ command: "printf '\\377\\376'" });

    assert.equal(result.status, 'success');
    assert.match(singleData(result).output, /\uFFFD/u);
  });

  it('executes a 10,000-character command string', { timeout: 20_000 }, async () => {
    const payload = 'a'.repeat(9_990);
    const result = await harness.run({ command: `echo ${payload}` });

    assert.equal(result.status, 'success');
    assert.equal(singleData(result).output.trim(), payload);
  });

  it('interrupts two concurrently aborted commands cleanly', { timeout: 25_000 }, async () => {
    const first = new AbortController();
    const second = new AbortController();
    const timer = setTimeout(() => {
      first.abort();
      second.abort();
    }, 600);

    try {
      const [left, right] = await Promise.all([
        harness.run({ command: 'sleep 10', timeout: 20 }, first.signal),
        harness.run({ command: 'sleep 10', timeout: 20 }, second.signal),
      ]);

      assert.equal(resultCode(left), 'TERMINAL_INTERRUPTED');
      assert.equal(resultCode(right), 'TERMINAL_INTERRUPTED');
    } finally {
      clearTimeout(timer);
    }
  });
});