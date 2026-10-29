import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createStandardKernel } from '../../../src/bootstrap/createKernel.js';
import { TerminalToken } from '../descriptor/tokens.js';
import type { ITerminalService, TerminalChunkCallback } from '../contracts/ITerminalService.js';
import { InMemoryStorageDriver } from '../../../drivers/memory/index.js';
import { ValidationToken } from '../../ValidationService/descriptor/tokens.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';

describe('TerminalService bootstrap registration', () => {
  it('registers brud.core.terminal after validation and resolves it through the kernel', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      historyJournal: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const caller: ServiceContext = { callerId: 'test', tier: 'core', workspaceRoot: '/workspace' };
    const terminal = kernel.requestAccess(caller, TerminalToken);
    const validation = kernel.requestAccess(caller, ValidationToken);

    assert.strictEqual(terminal.getPolicy().schemaVersion, 1);
    assert.strictEqual(validation.getPolicy().schemaVersion, 1);
    assert.ok(terminal.getPolicy().maxOutputBytes > 0);
    assert.strictEqual(terminal.activeSessions().length, 0);
    await kernel.shutdown();
  });

  it('disposes orphan sessions when the kernel shuts down', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      historyJournal: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const terminal = kernel.requestAccess<ITerminalService>(
      { callerId: 'test', tier: 'core', workspaceRoot: '/workspace' },
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

  it('exposes the legacy chunk callback surface through the kernel authority', async () => {
    const kernel = createStandardKernel({
      storageDriver: new InMemoryStorageDriver(),
      history: { inMemory: true },
      historyJournal: { inMemory: true },
    });

    await kernel.boot({ workspaceRoot: '/workspace' });

    const terminal = kernel.requestAccess<ITerminalService>(
      { callerId: 'test', tier: 'core', workspaceRoot: '/workspace' },
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
