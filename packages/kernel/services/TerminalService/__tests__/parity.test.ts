import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TerminalService } from '../orchestrator/TerminalService.js';
import type {
  TerminalGroupOutcome,
  TerminalRunOutcome,
} from '../contracts/ITerminalService.js';

const policy = {
  ...(await import('../contracts/policies.js')).DEFAULT_TERMINAL_POLICY,
};

function createService(workspaceRoot: string): TerminalService {
  return new TerminalService({ policy, workspaceRoot, __allowUnsafeTestExecution: true });
}

function single(result: TerminalRunOutcome | TerminalGroupOutcome): TerminalRunOutcome {
  const group = result as TerminalGroupOutcome;

  return Array.isArray(group.results) ? (group.results[0] as TerminalRunOutcome) : (result as TerminalRunOutcome);
}

describe('TerminalService parity', () => {
  let workspace: string;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'brud-terminal-parity-'));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('runs a simple command', async () => {
    const service = createService(workspace);
    const decision = await service.run({ command: 'echo hello', mode: 'single', cwd: workspace });

    assert.strictEqual(decision.ok, true);
    assert.ok(decision.ok);
    const outcome = single(decision.result);

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.exitCode, 0);
    assert.ok(outcome.output.includes('hello'));
    await service.dispose();
  });

  it('resolves failures with the real exit code instead of rewrapping them as success', async () => {
    const service = createService(workspace);
    const decision = await service.run({ command: 'ls /nonexistent-brud', cwd: workspace });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_EXIT_NONZERO');
    assert.strictEqual(decision.legacyCode, 'EXECUTION_FAILED');
    assert.notStrictEqual(decision.exitCode, null);
    assert.notStrictEqual(decision.exitCode, 0);
    await service.dispose();
  });

  it('stops a sequential batch at the first failure', async () => {
    const service = createService(workspace);
    const decision = await service.run({
      commands: ['echo first', 'ls /nonexistent-brud', 'echo never'],
      mode: 'sequential',
      cwd: workspace,
      stopOnFailure: true,
    });

    assert.strictEqual(decision.ok, false);
    assert.ok(!decision.ok);
    assert.strictEqual(decision.code, 'TERMINAL_EXIT_NONZERO');
    assert.notStrictEqual(decision.exitCode, 0);
    await service.dispose();
  });

  it('runs a parallel batch with one result per command', async () => {
    const service = createService(workspace);
    const decision = await service.run({
      commands: ['echo parallel_a', 'echo parallel_b'],
      mode: 'parallel',
      cwd: workspace,
    });

    assert.ok(decision.ok);
    const group = decision.result as TerminalGroupOutcome;

    assert.strictEqual(group.success, true);
    assert.strictEqual(group.results.length, 2);
    await service.dispose();
  });
});
