/**
 * Goal 4 — capability gating for `brud.core.terminal`.
 *
 * Exercises the real plugin manager, the real terminal service and the real
 * scoped handle. Synthetic plugins capture the capability-gated context the
 * kernel hands them.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from '../../bootstrap/index.js';
import type { BrudKernel } from '../../engine/BrudKernel.js';
import type {
  IBrudPlugin,
  IPluginContext,
  PluginPermission,
} from '../../../../services/PluginManager/contracts/index.js';
import type { OperationResult } from '../../contracts/handler.js';
import { PluginContext } from '../../../../services/PluginManager/contracts/PluginContext.js';
import { createTestPluginContext } from '../support/testApiRegistry.js';
import type { IPluginLogger } from '../../../../services/PluginManager/contracts/IPluginContext.js';
import { BrudToolsToken } from '../../../../services/BrudTools/descriptor/tokens.js';
import type { IBrudToolsService } from '../../../../services/BrudTools/contracts/index.js';
import { workspaceContextOptions } from '../support/workspaceContext.js';

interface CapturedPlugin {
  readonly plugin: IBrudPlugin;
  context(): IPluginContext | undefined;
}

function capturePlugin(
  id: string,
  permissions: readonly PluginPermission[],
): CapturedPlugin {
  let captured: IPluginContext | undefined;

  return {
    plugin: {
      manifest: {
        id,
        name: id,
        version: '0.0.1',
        permissions,
      },
      activate(context): void {
        captured = context;
      },
    },
    context: () => captured,
  };
}

function terminalPlugin(id: string): CapturedPlugin {
  const captured = capturePlugin(id, ['terminal:execute', 'tools:register']);

  return {
    plugin: {
      ...captured.plugin,
      activate(context): void {
        captured.plugin.activate(context);

        context.registerTool({
          name: `${id.split('.').pop()}_run`,
          description: 'Run a command through the scoped terminal handle',
          parametersSchema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
            additionalProperties: false,
          },
          execute: async (input): Promise<OperationResult> => {
            const handle = context.getTerminal();

            if (handle === null) {
              return { status: 'failed', error: 'NO_HANDLE' };
            }

            const result = await handle.run({ command: String(input.command) });

            return {
              status: result.success ? 'success' : 'failed',
              data: result,
            };
          },
        });
      },
    },
    context: captured.context,
  };
}

function nonTerminalPlugin(id: string): CapturedPlugin {
  const captured = capturePlugin(id, ['tools:register']);

  return {
    plugin: {
      ...captured.plugin,
      activate(context): void {
        captured.plugin.activate(context);

        context.registerTool({
          name: 'terminal_attempt',
          description: 'Attempt a terminal execution without the permission',
          parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
          execute: async (): Promise<OperationResult> => {
            const handle = context.getTerminal();
            const result = handle === null
              ? undefined
              : await handle.run({ command: 'echo should-not-run' });

            return {
              status: 'success',
              data: {
                handle: handle === null ? null : 'present',
                spawned: result !== undefined,
              },
            };
          },
        });
      },
    },
    context: captured.context,
  };
}

const LOGGER: IPluginLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('condition was not met before the deadline');
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let kernel: BrudKernel;
let root: string;
let tools: IBrudToolsService;
let without: CapturedPlugin;
let first: CapturedPlugin;
let second: CapturedPlugin;

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-terminal-capability-')));
  without = nonTerminalPlugin('test.capability.without');
  first = terminalPlugin('test.capability.first');
  second = terminalPlugin('test.capability.second');
  kernel = createStandardKernel({
    history: { inMemory: true },
    initialPlugins: [without.plugin, first.plugin, second.plugin],
  });

  await kernel.boot({ options: {...workspaceContextOptions(root)} });
  tools = kernel.requestAccess(
    { callerId: 'verification.capability', tier: 'core', options: {...workspaceContextOptions(root)} },
    BrudToolsToken,
  );
});

after(async () => {
  try {
    await kernel.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe('Goal 4 — getTerminal gating', () => {
  it('returns null when terminal:execute is not declared', () => {
    const context = without.context();

    assert.ok(context);
    assert.equal(context.getTerminal(), null);
  });

  it('returns a non-null handle when terminal:execute is declared', () => {
    const context = first.context();

    assert.ok(context);
    assert.notEqual(context.getTerminal(), null);
  });

  it('memoizes one handle per activation', () => {
    const context = first.context();

    assert.ok(context);
    assert.equal(context.getTerminal(), context.getTerminal());
  });

  it('exposes run, cancel, list and dispose on the handle', () => {
    const handle = first.context()?.getTerminal();

    assert.ok(handle);
    for (const method of ['run', 'cancel', 'list', 'dispose'] as const) {
      assert.equal(typeof handle[method], 'function', `${method} must be callable`);
    }
  });

  it('executes a real command through the scoped handle', async () => {
    const result = await tools.executeTool(
      'first_run',
      { command: 'echo capability-ok' },
      { workspaceRoot: root, callerId: 'verification.capability' },
    );

    assert.equal(result.status, 'success', String(result.error));
    const data = result.data as { readonly output?: string; readonly success?: boolean };

    assert.equal(data.success, true);
    assert.match(data.output ?? '', /capability-ok/u);
  });

  it('pins the handle cwd to the plugin workspace', async () => {
    const result = await tools.executeTool(
      'first_run',
      { command: 'pwd' },
      { workspaceRoot: root, callerId: 'verification.capability' },
    );

    const data = result.data as { readonly output?: string };

    assert.equal(result.status, 'success', String(result.error));
    assert.equal(data.output?.trim(), root);
  });

  it('prevents a plugin without terminal:execute from spawning', async () => {
    const result = await tools.executeTool(
      'terminal_attempt',
      {},
      { workspaceRoot: root, callerId: 'verification.capability' },
    );

    assert.equal(result.status, 'success');
    assert.deepEqual(result.data, { handle: null, spawned: false });
  });

  it('returns null when the permission is declared but no terminal service exists', () => {
    const context = createTestPluginContext({
      pluginId: 'test.capability.service-less',
      workspaceRoot: root,
      permissions: ['terminal:execute'],
    }).context;

    assert.equal(context.getTerminal(), null);
  });
});

describe('Goal 4 — handle isolation and projection', () => {
  it('gives two plugins distinct scoped handles', () => {
    const left = first.context()?.getTerminal();
    const right = second.context()?.getTerminal();

    assert.ok(left);
    assert.ok(right);
    assert.notEqual(left, right);
  });

  it('freezes the handle projection', () => {
    const handle = first.context()?.getTerminal();

    assert.ok(handle);
    assert.equal(Object.isFrozen(handle), true);
  });

  it('does not expose the full terminal service surface', () => {
    const handle = first.context()?.getTerminal() as unknown as Record<string, unknown>;

    assert.ok(handle);
    for (const method of ['activeSessions', 'getPolicy', 'registerChild', 'killAll']) {
      assert.equal(handle[method], undefined, `${method} must not leak through the handle`);
    }
  });

  it('lists only sessions owned by the calling plugin', { timeout: 15_000 }, async () => {
    const left = first.context()?.getTerminal();
    const right = second.context()?.getTerminal();

    assert.ok(left);
    assert.ok(right);

    const pendingLeft = left.run({ command: 'sleep 1' });
    const pendingRight = right.run({ command: 'sleep 1' });

    try {
      await waitFor(() => left.list().length === 1 && right.list().length === 1);

      assert.equal(left.list()[0]?.callerId, 'test.capability.first');
      assert.equal(right.list()[0]?.callerId, 'test.capability.second');
      assert.notEqual(left.list()[0]?.executionId, right.list()[0]?.executionId);
    } finally {
      for (const execution of left.list()) {
        await left.cancel(execution.executionId);
      }
      for (const execution of right.list()) {
        await right.cancel(execution.executionId);
      }
      await Promise.allSettled([pendingLeft, pendingRight]);
    }
  });

  it('cannot cancel a session owned by another plugin', { timeout: 15_000 }, async () => {
    const left = first.context()?.getTerminal();
    const right = second.context()?.getTerminal();

    assert.ok(left);
    assert.ok(right);

    const pendingRight = right.run({ command: 'sleep 1' });

    try {
      await waitFor(() => right.list().length === 1);
      const foreignId = right.list()[0]?.executionId;

      assert.ok(foreignId);
      await left.cancel(foreignId);
      assert.equal(right.list().some((entry) => entry.executionId === foreignId), true);
    } finally {
      await right.dispose();
      await Promise.allSettled([pendingRight]);
    }
  });
});
