import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TerminalService } from '../orchestrator/TerminalService.js';
import type { TerminalServiceOptions, TerminalValidatorPort } from '../orchestrator/TerminalService.js';
import { DEFAULT_TERMINAL_POLICY } from '../contracts/policies.js';
import { validationFailure } from '../../ValidationService/contracts/errors.js';
import type {
  TerminalGroupOutcome,
  TerminalRunOutcome,
} from '../contracts/ITerminalService.js';

/** Records every command the gate sees and refuses `rm -rf` payloads. */
class RecordingValidator implements TerminalValidatorPort {
  readonly seen: string[] = [];

  validateCommand(command: string, cwd?: string) {
    void cwd;
    this.seen.push(command);

    if (command.trim().length === 0) {
      return validationFailure({
        code: 'MISSING_FIELD',
        rule: 'CMD.NO_COMMAND',
        legacyCode: 'MISSING_FIELD',
        friendly: 'Command rejected.',
        details: 'The command is empty.',
        actionable: true,
        retryable: false,
      });
    }

    if (command.includes('rm -rf')) {
      return validationFailure({
        code: 'DANGEROUS_COMMAND',
        rule: 'CMD.RM_ROOT',
        legacyCode: 'DANGEROUS_COMMAND',
        friendly: 'Command rejected.',
        details: `The command "${command}" is blocked.`,
        command,
        actionable: true,
        retryable: false,
      });
    }

    return { ok: true as const };
  }
}

function outcomeOf(result: TerminalRunOutcome | TerminalGroupOutcome): TerminalRunOutcome {
  const group = result as TerminalGroupOutcome;

  return Array.isArray(group.results) ? (group.results[0] as TerminalRunOutcome) : (result as TerminalRunOutcome);
}

/**
 * Builds an engine-isolation harness: no validation authority is bound, so the
 * test-only flag is required and every assertion below still exercises the
 * real spawn, stream and reaping path.
 */
function harness(options: Partial<TerminalServiceOptions> & { workspaceRoot: string }): TerminalService {
  return new TerminalService({
    policy: DEFAULT_TERMINAL_POLICY,
    ...options,
    __allowUnsafeTestExecution: true,
  });
}

describe('TerminalService security and limits', () => {
  let workspace: string;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'brud-terminal-security-'));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('F-1: validates onSuccess and onFailure branches before spawning', async () => {
    const validator = new RecordingValidator();
    const service = new TerminalService({ policy: DEFAULT_TERMINAL_POLICY, validator, workspaceRoot: workspace });

    const decision = await service.run({
      command: 'echo ok',
      mode: 'conditional',
      cwd: workspace,
      onFailure: { type: 'sequential', commands: ['rm -rf /'] },
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_BLOCKED');
    assert.strictEqual(decision.legacyCode, 'DANGEROUS_COMMAND');
    assert.ok(validator.seen.includes('rm -rf /'));
    // Only the validation pass ran: no process was registered or spawned.
    assert.strictEqual(service.activeSessions().length, 0);
    await service.dispose();
  });

  it('F-1: validates nested group commands inside a branch', async () => {
    const validator = new RecordingValidator();
    const service = new TerminalService({ policy: DEFAULT_TERMINAL_POLICY, validator, workspaceRoot: workspace });

    const decision = await service.run({
      command: 'echo ok',
      mode: 'conditional',
      cwd: workspace,
      onSuccess: {
        type: 'parallel',
        commands: ['echo nested', { type: 'sequential', commands: ['rm -rf /tmp/x'] }],
      },
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(validator.seen.includes('rm -rf /tmp/x'));
    await service.dispose();
  });

  it('F-2: does not inherit host secrets into the child environment', async () => {
    const service = harness({ workspaceRoot: workspace });
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_secret_value';

    try {
      const decision = await service.run({
        command: 'printf "%s" "${GITHUB_TOKEN:-absent}"',
        cwd: workspace,
      });

      assert.ok(decision.ok);
      assert.strictEqual(outcomeOf(decision.result).output, 'absent');
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previous;
      }

      await service.dispose();
    }
  });

  it('F-9: rejects a request that tries to set an extension secret', async () => {
    // The environment gate runs before the validation gate, so this assertion
    // holds with or without a bound authority.
    const service = harness({ workspaceRoot: workspace });
    const decision = await service.run({
      command: 'echo should_not_run',
      cwd: workspace,
      env: { OPENAI_API_KEY: 'sk-leak' },
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_INVALID_REQUEST');
    await service.dispose();
  });

  it('F-9: drops dangerous environment overrides instead of applying them', async () => {
    const service = harness({ workspaceRoot: workspace });
    const decision = await service.run({
      command: 'printf "%s" "${LD_PRELOAD:-unset}:${NODE_OPTIONS:-unset}"',
      cwd: workspace,
      env: { LD_PRELOAD: '/tmp/evil.so', NODE_OPTIONS: '--require /tmp/x.js' },
    });

    assert.ok(decision.ok);
    assert.strictEqual(outcomeOf(decision.result).output, 'unset:unset');
    await service.dispose();
  });

  it('F-3: bounds output at the ceiling and reports truncation', async () => {
    const service = harness({
      policy: { ...DEFAULT_TERMINAL_POLICY, maxOutputBytes: 4096 },
      workspaceRoot: workspace,
    });
    const startedAt = Date.now();
    const decision = await service.run({
      command: 'i=0; while [ $i -lt 200000 ]; do printf "0123456789"; i=$((i+1)); done; sleep 10',
      cwd: workspace,
      timeoutMs: 20_000,
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_OUTPUT_LIMIT');
    assert.strictEqual(decision.legacyCode, 'TERMINAL_OUTPUT_LIMIT');
    // The tree was killed on the breach, not after the 10s sleep.
    assert.ok(Date.now() - startedAt < 9_000, 'a limit breach must kill the process immediately');
    await service.dispose();
  });

  it('F-4: killAll terminates every live session', async () => {
    const service = harness({ workspaceRoot: workspace });
    const running = service.run({ command: 'sleep 30', cwd: workspace, timeoutMs: 30_000 });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(service.activeSessions().length >= 1);

    const killed = service.killAll();
    const decision = await running;

    assert.ok(killed >= 1);
    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_INTERRUPTED');
    assert.strictEqual(service.activeSessions().length, 0);
    await service.dispose();
  });

  it('F-5: interactive sessions register, stream and can be cancelled', async () => {
    const scriptPath = path.join(workspace, 'ask.sh');
    await fs.writeFile(scriptPath, '#!/bin/bash\nprintf "Name?"\nread name\necho "Hello, $name!"\n');
    await fs.chmod(scriptPath, 0o755);

    const service = harness({ workspaceRoot: workspace });
    const chunks: string[] = [];
    const decision = await service.run(
      { command: `bash ${scriptPath}`, mode: 'interactive', answers: ['Brud'], cwd: workspace },
      { onChunk: (chunk) => chunks.push(chunk) },
    );

    assert.ok(decision.ok);
    assert.ok(outcomeOf(decision.result).output.includes('Hello, Brud!'));
    assert.ok(chunks.length > 0);

    const controller = new AbortController();
    const running = service.run(
      { command: 'sleep 30', cwd: workspace, timeoutMs: 30_000 },
      { signal: controller.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(service.activeSessions().length >= 1);
    controller.abort();

    const aborted = await running;

    assert.strictEqual(aborted.ok, false);
    assert.ok(!aborted.ok);
    assert.strictEqual(aborted.code, 'TERMINAL_INTERRUPTED');
    await service.dispose();
  });

  it('reports a spawn failure through the outcome rather than dropping it', async () => {
    const service = harness({ workspaceRoot: workspace });
    const decision = await service.run({
      command: 'echo unreachable',
      cwd: path.join(workspace, 'missing-directory'),
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_SPAWN_FAILED');
    assert.strictEqual(decision.legacyCode, 'EXECUTION_FAILED');
    await service.dispose();
  });

  it('refuses a request with no resolvable working directory', async () => {
    const service = new TerminalService({
      policy: DEFAULT_TERMINAL_POLICY,
      validator: new RecordingValidator(),
    });
    const decision = await service.run({ command: 'echo hello' });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_INVALID_REQUEST');
    await service.dispose();
  });

  it('refuses a batch above the command ceiling', async () => {
    const service = harness({
      policy: { ...DEFAULT_TERMINAL_POLICY, maxBatchCommands: 2 },
      workspaceRoot: workspace,
    });
    const decision = await service.run({
      commands: ['echo 1', 'echo 2', 'echo 3'],
      mode: 'sequential',
      cwd: workspace,
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.legacyCode, 'BATCH_LIMIT_EXCEEDED');
    await service.dispose();
  });

  it('H-1: fails closed with TERMINAL_UNAVAILABLE when no validation authority is bound', async () => {
    const service = new TerminalService({ policy: DEFAULT_TERMINAL_POLICY, workspaceRoot: workspace });
    const startedAt = Date.now();
    const decision = await service.run({ command: 'echo must_not_run', cwd: workspace });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_UNAVAILABLE');
    assert.strictEqual(decision.legacyCode, 'TERMINAL_UNAVAILABLE');
    assert.strictEqual(decision.retryable, true);
    assert.strictEqual(decision.actionable, false);
    assert.ok(Date.now() - startedAt < 1_000, 'the refusal must be immediate');
    assert.strictEqual(service.activeSessions().length, 0);
    await service.dispose();
  });

  it('H-1: refuses a blank command through the bound gate instead of trusting it', async () => {
    const validator = new RecordingValidator();
    const service = new TerminalService({ policy: DEFAULT_TERMINAL_POLICY, validator, workspaceRoot: workspace });
    const decision = await service.run({ command: '   ', cwd: workspace });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_INVALID_REQUEST');
    assert.deepStrictEqual(validator.seen, ['   ']);
    await service.dispose();
  });

  it('H-2: reports a timeout as TERMINAL_TIMEOUT rather than a success', async () => {
    const service = harness({ workspaceRoot: workspace });
    const decision = await service.run({ command: 'sleep 30', cwd: workspace, timeoutMs: 150 });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_TIMEOUT');
    assert.strictEqual(decision.legacyCode, 'TERMINAL_TIMEOUT');
    await service.dispose();
  });

  it('H-2: a sparse sequential batch reports the first terminating failure', async () => {
    const service = harness({ workspaceRoot: workspace });
    const decision = await service.run({
      commands: ['echo first', 'exit 3', 'echo never'],
      mode: 'sequential',
      cwd: workspace,
      stopOnFailure: true,
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_EXIT_NONZERO');
    assert.strictEqual(decision.exitCode, 3);
    await service.dispose();
  });

  it('H-4: an interrupt is classified as TERMINAL_INTERRUPTED, not a timeout', async () => {
    const controller = new AbortController();
    const service = harness({ workspaceRoot: workspace });
    const running = service.run(
      { command: 'sleep 30', cwd: workspace, timeoutMs: 30_000 },
      { signal: controller.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    controller.abort();

    const decision = await running;

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_INTERRUPTED');
    await service.dispose();
  });

  it('M-3: preserves interleaved stdout/stderr arrival order', async () => {
    const service = harness({ workspaceRoot: workspace });
    // One fixed-size write per channel avoids kernel coalescing; the two
    // writes are then forced through the pipes in a known order.
    const decision = await service.run({
      command: 'printf "[out]"; sleep 0.1; printf "[err]" >&2; printf "[out2]"',
      cwd: workspace,
    });

    assert.ok(decision.ok);
    const output = outcomeOf(decision.result).output;

    assert.ok(output.indexOf('[out]') < output.indexOf('[err]'), `out before err: ${output}`);
    assert.ok(output.indexOf('[err]') < output.indexOf('[out2]'), `err before out2: ${output}`);
    await service.dispose();
  });

  it('L-6: keeps chunkIndex monotonic across a sequential batch', async () => {
    const seen: Array<{ index: number; chunk: string }> = [];
    const service = harness({ workspaceRoot: workspace });
    const decision = await service.run(
      { commands: ['printf aa', 'printf bb'], mode: 'sequential', cwd: workspace },
      { onChunk: (chunk, chunkIndex) => seen.push({ index: chunkIndex, chunk }) },
    );

    assert.ok(decision.ok);
    assert.ok(seen.length >= 2);
    const indices = seen.map((entry) => entry.index);

    assert.deepStrictEqual(indices, [...indices].sort((left, right) => left - right));
    assert.strictEqual(new Set(indices).size, indices.length, 'chunkIndex must not restart per command');
    await service.dispose();
  });
});

describe('TerminalService collaborator boundary isolation', () => {
  let workspace: string;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'brud-terminal-boundary-'));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('M-1: resolves TERMINAL_INTERNAL instead of rejecting when the validator throws', async () => {
    const validator = new (class implements TerminalValidatorPort {
      validateCommand(): never {
        throw new Error('validator boom');
      }
    })();
    const service = new TerminalService({ policy: DEFAULT_TERMINAL_POLICY, validator, workspaceRoot: workspace });

    const decision = await service.run({ command: 'echo hi', cwd: workspace });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_INTERNAL');
    assert.strictEqual(decision.legacyCode, 'INTERNAL_ERROR');
    assert.strictEqual(decision.retryable, true);
    assert.strictEqual(service.activeSessions().length, 0);
    await service.dispose();
  });

  it('M-1: a throwing onChunk consumer does not crash the run and output is still collected', async () => {
    const service = harness({ workspaceRoot: workspace });

    const decision = await service.run(
      { command: 'echo hello; echo world', cwd: workspace },
      {
        onChunk: () => {
          throw new Error('ui boom');
        },
      },
    );

    assert.ok(decision.ok);
    assert.strictEqual(outcomeOf(decision.result).output, 'hello\nworld\n');
    await service.dispose();
  });

  it('M-1: a throwing onChunk consumer preserves the exit status of a failed command', async () => {
    const service = harness({ workspaceRoot: workspace });

    const decision = await service.run(
      { command: 'echo x; exit 9', cwd: workspace },
      {
        onChunk: () => {
          throw new Error('ui boom');
        },
      },
    );

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_EXIT_NONZERO');
    assert.strictEqual(decision.exitCode, 9);
    await service.dispose();
  });

  it('L-1: a ceiling breach reaps the child with reason "limit"', async () => {
    const service = harness({
      policy: { ...DEFAULT_TERMINAL_POLICY, maxOutputBytes: 1024 },
      workspaceRoot: workspace,
    });
    const manager = service.processes as unknown as {
      spawn: (options: unknown) => { closed: Promise<{ reason: string }> };
    };
    const reasons: string[] = [];
    const realSpawn = manager.spawn.bind(manager);
    manager.spawn = (options) => {
      const handle = realSpawn(options);
      void handle.closed.then((exit) => reasons.push(exit.reason));

      return handle;
    };

    const decision = await service.run({ command: 'yes', cwd: workspace, timeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_OUTPUT_LIMIT');
    assert.deepStrictEqual(reasons, ['limit']);
    assert.deepStrictEqual(service.processes.livePids(), []);
    await service.dispose();
  });
});
