/**
 * Boot policy of `brud.core.terminal` (F-3, T-2).
 *
 * The terminal reads the frozen settings snapshot once, in the boot pinner,
 * where the broker serves requests. An unreadable snapshot denies execution
 * instead of falling back to defaults, and the boot workspace root survives
 * the pin.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from '../../../src/bootstrap/createKernel.js';
import type { IKernelAccessBroker, ServiceInfo } from '../../../src/contracts/accessBroker.js';
import type { KernelLogger, ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceToken } from '../../../src/contracts/serviceToken.js';
import type { ISettingsReader, SettingsSnapshot } from '../../SettingsService/contracts/ISettingsService.js';
import { SettingsToken } from '../../SettingsService/descriptor/tokens.js';
import { InMemoryConfigStore } from '../../SettingsService/storage/InMemoryConfigStore.js';
import type { TerminalDecision } from '../contracts/errors.js';
import type { TerminalRunOutcome } from '../contracts/ITerminalService.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import { createTerminalDescriptor, pinTerminalPolicies } from '../descriptor/TerminalDescriptor.js';
import { TerminalToken } from '../descriptor/tokens.js';
import type { TerminalValidatorPort } from '../orchestrator/TerminalService.js';

const allowAll: TerminalValidatorPort = { validateCommand: () => ({ ok: true as const }) };

function recordingLogger(): KernelLogger & { readonly warnings: string[] } {
  const warnings: string[] = [];

  return {
    warnings,
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (message: string): void => {
      warnings.push(message);
    },
    error: (): void => undefined,
  } as KernelLogger & { readonly warnings: string[] };
}

async function withWorkspace(run: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'brud-terminal-boot-'));

  try {
    await run(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runInStandardKernel(
  workspace: string,
  userSettings: Record<string, unknown> | undefined,
  command: string,
  cwd: string | undefined,
): Promise<{ decision: TerminalDecision; warnings: readonly string[] }> {
  const logger = recordingLogger();
  const kernel = createStandardKernel({
    history: { inMemory: true },
    settings: {
      store: new InMemoryConfigStore({
        userContent: userSettings === undefined ? null : JSON.stringify(userSettings),
      }),
    },
  });

  await kernel.boot({ workspaceRoot: workspace, logger });

  try {
    const caller: ServiceContext = { callerId: 'test.terminal', tier: 'core', workspaceRoot: workspace };
    const terminal = kernel.requestAccess(caller, TerminalToken);
    const decision = await terminal.run({ command, ...(cwd === undefined ? {} : { cwd }) });

    return { decision, warnings: logger.warnings };
  } finally {
    await kernel.shutdown();
  }
}

/**
 * Broker that refuses the settings token while `open` is false, like the real
 * broker during BOOTING, and serves `snapshot` afterwards.
 */
class GatedSettingsBroker implements IKernelAccessBroker {
  public open = false;

  public reads = 0;

  constructor(private readonly snapshot: (() => SettingsSnapshot) | undefined) {}

  requestAccess<TService>(_caller: ServiceContext, token: ServiceToken<TService>): TService {
    if (token.id === WorkspaceToken.id) {
      return { primaryRoot: '/workspace' } as TService;
    }

    if (token.id !== SettingsToken.id) {
      throw new Error(`unexpected token ${token.id}`);
    }

    if (!this.open || this.snapshot === undefined) {
      throw new Error('settings unavailable');
    }

    const snapshot = this.snapshot;
    const reader = {
      getSnapshot: (): SettingsSnapshot => {
        this.reads += 1;
        return snapshot();
      },
    } as unknown as ISettingsReader;

    return reader as TService;
  }

  hasService(): boolean {
    return true;
  }

  listServices(): readonly ServiceInfo[] {
    return [];
  }
}

const bootContext = (workspace: string, logger?: KernelLogger): ServiceContext => ({
  callerId: 'kernel',
  tier: 'core',
  workspaceRoot: workspace,
  ...(logger === undefined ? {} : { logger }),
});

describe('TerminalService boot policy', () => {
  it("uses the user's commandValidationEnabled setting, not the default", async () => {
    await withWorkspace(async (workspace) => {
      // Default (true): the dangerous-command rule blocks before any spawn.
      const byDefault = await runInStandardKernel(workspace, undefined, 'echo mkfs', workspace);
      assert.equal(byDefault.decision.ok, false);
      assert.ok(!byDefault.decision.ok);
      assert.equal(byDefault.decision.code, 'TERMINAL_BLOCKED');
      assert.equal(byDefault.decision.rule, 'CMD.DISK');

      // The user turns command validation off: the same command now runs.
      const userOff = await runInStandardKernel(
        workspace,
        { commandValidationEnabled: false },
        'echo mkfs',
        workspace,
      );
      assert.ok(userOff.decision.ok, JSON.stringify(userOff.decision));
      assert.equal((userOff.decision.result as TerminalRunOutcome).output, 'mkfs\n');
    });
  });

  it('reads the settings snapshot at boot instead of falling back to defaults', async () => {
    await withWorkspace(async (workspace) => {
      const { warnings } = await runInStandardKernel(workspace, undefined, 'echo ok', workspace);

      assert.deepEqual(
        warnings.filter((message) => message.includes('settings snapshot could not be read')),
        [],
      );
    });

    // Descriptor level: the snapshot is read once, when the gate is open.
    const broker = new GatedSettingsBroker(
      () => ({ maxTimeoutMs: 1234, defaultTimeoutMs: 1000 }) as unknown as SettingsSnapshot,
    );
    const service = createTerminalDescriptor({ validator: allowAll }).factory(bootContext('/workspace'), broker);

    broker.open = true;
    pinTerminalPolicies([service]);

    assert.equal(broker.reads, 1);
    assert.equal(service.getPolicy().maxTimeoutMs, 1234);
    assert.equal(service.getPolicy().defaultTimeoutMs, 1000);
    await service.dispose();
  });

  it('denies execution when the settings snapshot cannot be read (fail closed)', async () => {
    await withWorkspace(async (workspace) => {
      const logger = recordingLogger();
      const broker = new GatedSettingsBroker(() => {
        throw new Error('settings store corrupted');
      });
      // A bound validator is supplied on purpose: the policy failure alone
      // must be enough to refuse.
      const service = createTerminalDescriptor({ validator: allowAll }).factory(
        bootContext(workspace, logger),
        broker,
      );

      broker.open = true;
      pinTerminalPolicies([service]);

      const decision = await service.run({ command: 'echo should-not-run', cwd: workspace });

      assert.ok(!decision.ok);
      assert.equal(decision.code, 'TERMINAL_UNAVAILABLE');
      assert.match(decision.details, /policy could not be read at boot \(settings store corrupted\)/u);
      assert.equal(service.activeSessions().length, 0);
      assert.ok(logger.warnings.some((message) => /terminal execution is denied/u.test(message)));
      await service.dispose();
    });
  });

  it('keeps the boot workspace root so a request without cwd runs there', async () => {
    await withWorkspace(async (workspace) => {
      const { decision } = await runInStandardKernel(workspace, undefined, 'pwd', undefined);

      assert.ok(decision.ok, JSON.stringify(decision));
      assert.equal((decision.result as TerminalRunOutcome).output.trim(), workspace);
    });
  });
});
