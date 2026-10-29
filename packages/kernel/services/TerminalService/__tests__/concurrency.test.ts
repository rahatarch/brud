import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TerminalService } from '../orchestrator/TerminalService.js';
import { DEFAULT_TERMINAL_POLICY } from '../contracts/policies.js';
import type { TerminalGroupOutcome } from '../contracts/ITerminalService.js';

describe('TerminalService concurrency governor', () => {
  it('never exceeds the child-process ceiling inside one parallel batch', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'brud-terminal-concurrency-'));
    const probe = path.join(workspace, 'probe.sh');
    const ledger = path.join(workspace, 'ledger');
    // Each child records its start, sleeps briefly, then records its end; the
    // maximum number of overlapping records proves the ceiling.
    await fs.writeFile(
      probe,
      `#!/bin/bash
echo start >> "${ledger}"
sleep 0.2
echo end >> "${ledger}"
`,
    );
    await fs.chmod(probe, 0o755);

    const service = new TerminalService({
      policy: { ...DEFAULT_TERMINAL_POLICY, concurrency: 2, maxBatchCommands: 6 },
      workspaceRoot: workspace,
      __allowUnsafeTestExecution: true,
    });

    try {
      const decision = await service.run({
        commands: Array.from({ length: 6 }, () => `bash ${probe}`),
        mode: 'parallel',
        cwd: workspace,
      });

      assert.ok(decision.ok);
      assert.strictEqual((decision.result as TerminalGroupOutcome).success, true);

      const events = (await fs.readFile(ledger, 'utf-8')).trim().split('\n');
      let active = 0;
      let peak = 0;

      for (const event of events) {
        active += event === 'start' ? 1 : -1;
        peak = Math.max(peak, active);
      }

      assert.ok(peak <= 2, `expected at most 2 concurrent children, saw ${peak}`);
    } finally {
      await service.dispose();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('queues a second request until the first child frees its slot', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'brud-terminal-queue-'));
    const service = new TerminalService({
      policy: { ...DEFAULT_TERMINAL_POLICY, concurrency: 1 },
      workspaceRoot: workspace,
      __allowUnsafeTestExecution: true,
    });

    try {
      const first = service.run({ command: 'sleep 0.3', cwd: workspace, timeoutMs: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = service.run({ command: 'echo second', cwd: workspace });

      const [firstDecision, secondDecision] = await Promise.all([first, second]);

      assert.ok(firstDecision.ok);
      assert.ok(secondDecision.ok);
      assert.strictEqual(service.activeSessions().length, 0);
    } finally {
      await service.dispose();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
