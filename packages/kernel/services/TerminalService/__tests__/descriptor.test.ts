import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from '../../../src/bootstrap/index.js';
import { TerminalToken } from '../descriptor/tokens.js';
import type { ITerminalService, TerminalChunkCallback } from '../contracts/ITerminalService.js';
import { ValidationToken } from '../../ValidationService/descriptor/tokens.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';

let workspaceRoot = '';

before(async () => {
  workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'brud-terminal-descriptor-')));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function caller(overrides?: Partial<ServiceContext>): ServiceContext {
  return { callerId: 'test', tier: 'core', workspaceRoot, ...overrides };
}

describe('TerminalService bootstrap registration', () => {
  it('registers brud.core.terminal after validation and resolves it through the kernel', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: { workspaceRoot } });

    const terminal = kernel.requestAccess(caller(), TerminalToken);
    const validation = kernel.requestAccess(caller(), ValidationToken);

    assert.strictEqual(terminal.getPolicy().schemaVersion, 1);
    assert.strictEqual(validation.getPolicy().schemaVersion, 1);
    assert.ok(terminal.getPolicy().maxOutputBytes > 0);
    assert.strictEqual(terminal.activeSessions().length, 0);
    await kernel.shutdown();
  });

  it('disposes orphan sessions when the kernel shuts down', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: { workspaceRoot } });

    const terminal = kernel.requestAccess<ITerminalService>(
      caller(),
      TerminalToken,
    );
    terminal.registerExternal(
      {
        processId: 'proc-external',
        mode: 'single',
        command: 'sleep 0',
        startedAt: Date.now(),
      },
      { terminate: () => undefined },
    );
    assert.strictEqual(terminal.activeSessions().length, 1);

    await kernel.shutdown();

    // The descriptor's dispose drained the registry.
    assert.strictEqual(terminal.activeSessions().length, 0);
  });

  it('exposes the chunk callback surface through the kernel authority', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
    });

    await kernel.boot({ options: { workspaceRoot } });

    const terminal = kernel.requestAccess<ITerminalService>(
      caller(),
      TerminalToken,
    );
    const callback: TerminalChunkCallback = () => undefined;

    terminal.registerExternal(
      { processId: 'proc-stream', mode: 'single', command: 'echo', startedAt: Date.now() },
      { onChunk: callback, terminate: () => undefined },
    );

    assert.strictEqual(terminal.chunkCallback('proc-stream'), callback);
    assert.strictEqual(terminal.hasSession('proc-stream'), true);
    await kernel.shutdown();
  });
});
