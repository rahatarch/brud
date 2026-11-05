import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ITerminalService,
  TerminalChunkCallback,
  TerminalResult,
  TerminalRunRequest,
  TerminalSessionInfo,
} from '../../TerminalService/contracts/ITerminalService.js';
import type { TerminalDecision } from '../../TerminalService/contracts/errors.js';
import type { IPluginLogger } from '../contracts/IPluginContext.js';
import { PluginContext } from '../contracts/PluginContext.js';
import type { PluginCapabilityProviders } from '../contracts/PluginContext.js';
import type { PluginPermission } from '../contracts/permissions.js';
import { CAPABILITY_PERMISSION_REQUIREMENTS } from '../contracts/permissions.js';

const LOGGER: IPluginLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

const UNUSED_PROVIDERS: Pick<PluginCapabilityProviders, 'fileSystem' | 'universalHistory'> = {
  fileSystem: () => {
    throw new Error('filesystem is not used in this test');
  },
  universalHistory: () => {
    throw new Error('history is not used in this test');
  },
};

interface FakeTerminalService extends ITerminalService {
  readonly calls: TerminalRunRequest[];
  readonly killed: string[];
  readonly sessions: TerminalSessionInfo[];
}

function createFakeTerminal(): FakeTerminalService {
  const calls: TerminalRunRequest[] = [];
  const killed: string[] = [];
  const sessions: TerminalSessionInfo[] = [];
  let counter = 0;

  const service = {
    calls,
    killed,
    sessions,
    async run(request: TerminalRunRequest): Promise<TerminalDecision> {
      calls.push(request);
      counter += 1;
      sessions.push({
        processId: `proc-${counter}`,
        pid: 1000 + counter,
        mode: request.mode ?? 'single',
        ...(request.callerId === undefined ? {} : { callerId: request.callerId }),
        command: request.command ?? request.commands?.[0] ?? '',
        startedAt: 1_700_000_000_000 + counter,
      });

      return {
        ok: true,
        result: {
          success: true,
          output: 'ok',
          exitCode: 0,
          duration: 1,
          status: 'success',
        },
      };
    },
    registerExternal(): void {},
    registerChild(): string {
      return 'proc-external';
    },
    kill(sessionId: string): boolean {
      const index = sessions.findIndex((session) => session.processId === sessionId);

      if (index === -1) {
        return false;
      }

      killed.push(sessionId);
      sessions.splice(index, 1);

      return true;
    },
    killAll(): number {
      const count = sessions.length;

      for (const session of sessions) {
        killed.push(session.processId);
      }

      sessions.splice(0);

      return count;
    },
    activeSessions(): readonly TerminalSessionInfo[] {
      return [...sessions];
    },
    chunkCallback(): TerminalChunkCallback | undefined {
      return undefined;
    },
    hasSession(sessionId: string): boolean {
      return sessions.some((session) => session.processId === sessionId);
    },
    unregister(sessionId: string): void {
      const index = sessions.findIndex((session) => session.processId === sessionId);

      if (index !== -1) {
        sessions.splice(index, 1);
      }
    },
    getPolicy(): never {
      throw new Error('policy is not used in this test');
    },
  };

  return service as unknown as FakeTerminalService;
}

function createContext(
  permissions: readonly PluginPermission[],
  terminal?: () => ITerminalService,
): PluginContext {
  return new PluginContext({
    pluginId: 'acme.terminal.consumer',
    workspaceRoot: '/workspace',
    permissions,
    logger: LOGGER,
    capabilities: {
      ...UNUSED_PROVIDERS,
      ...(terminal === undefined ? {} : { terminal }),
    },
  });
}

describe('terminal plugin capability', () => {
  it('maps the terminal capability to terminal:execute', () => {
    assert.deepEqual(CAPABILITY_PERMISSION_REQUIREMENTS.terminal, ['terminal:execute']);
  });

  it('returns null when terminal:execute is not declared', () => {
    let resolutions = 0;
    const context = createContext(
      ['fs:read'],
      () => {
        resolutions += 1;
        return createFakeTerminal();
      },
    );

    assert.equal(context.getTerminal(), null);
    assert.equal(context.getTerminal(), null);
    assert.equal(resolutions, 0);
  });

  it('returns a scoped handle when terminal:execute is declared', async () => {
    const service = createFakeTerminal();
    let resolutions = 0;
    const context = createContext(['terminal:execute'], () => {
      resolutions += 1;
      return service;
    });

    const handle = context.getTerminal();

    assert.ok(handle !== null);
    assert.equal(handle, context.getTerminal(), 'the handle must be memoized');
    assert.equal(resolutions, 1);

    const result: TerminalResult = await handle.run({ command: 'echo hi' });

    assert.equal(result.success, true);
    assert.equal(service.calls.length, 1);
    assert.equal(service.calls[0]?.callerId, 'acme.terminal.consumer');
    assert.equal(service.calls[0]?.cwd, '/workspace');

    const executions = handle.list();

    assert.equal(executions.length, 1);
    assert.equal(executions[0]?.executionId, 'proc-1');
    assert.equal(executions[0]?.callerId, 'acme.terminal.consumer');
  });

  it('only lists, cancels, and disposes executions owned by the plugin', async () => {
    const service = createFakeTerminal();
    const context = createContext(['terminal:execute'], () => service);
    const handle = context.getTerminal();

    assert.ok(handle !== null);

    await handle.run({ command: 'first' });
    await handle.run({ command: 'second' });

    // A session attributed to another plugin must stay invisible.
    service.sessions.push({
      processId: 'proc-other',
      mode: 'single',
      callerId: 'other.plugin',
      command: 'other',
      startedAt: 1,
    });

    assert.deepEqual(
      handle.list().map((execution) => execution.executionId),
      ['proc-1', 'proc-2'],
    );

    await handle.cancel('proc-other');
    assert.deepEqual(service.killed, []);
    assert.equal(service.sessions.some((session) => session.processId === 'proc-other'), true);

    await handle.cancel('proc-1');
    assert.deepEqual(service.killed, ['proc-1']);

    await handle.dispose();
    assert.deepEqual(service.killed, ['proc-1', 'proc-2']);
    assert.deepEqual(handle.list(), []);
  });

  it('returns null when the permission is declared but no service is available', () => {
    const context = createContext(['terminal:execute']);

    assert.equal(context.getTerminal(), null);
  });
});