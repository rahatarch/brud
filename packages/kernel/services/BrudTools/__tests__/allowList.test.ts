import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperationResult } from '../../../src/contracts/handler.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import { createStandardKernel } from '../../../src/bootstrap/createKernel.js';
import { SettingsToken } from '../../SettingsService/descriptor/tokens.js';
import { InMemoryConfigStore } from '../../SettingsService/storage/InMemoryConfigStore.js';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
  ToolRegistrationOptions,
} from '../contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../descriptor/tokens.js';
import { BrudToolsService } from '../orchestrator/BrudToolsService.js';

const CONTEXT: IPluginExecutionContext = { workspaceRoot: '/workspace', callerId: 'test' };

function tool(name: string, onExecute: () => void): ToolRegistrationOptions {
  return {
    name,
    description: `${name} description`,
    parametersSchema: { type: 'object' },
    execute: async (): Promise<OperationResult> => {
      onExecute();

      return { status: 'success', data: { ran: name } };
    },
  };
}

describe('BrudToolsService tool allow-list', () => {
  it('refuses a tool explicitly disabled in the allow-list and never runs the handler', async () => {
    let ran = false;
    const service = new BrudToolsService({
      getToolAllowList: () => ({ create_file: false }),
    });

    service.registerTool('brud.filesystem', true, tool('create_file', () => {
      ran = true;
    }));

    const result = await service.executeTool('create_file', {}, CONTEXT);

    assert.equal(result.status, 'failed');
    assert.equal(
      result.error,
      'TOOL_DISABLED: tool "create_file" is disabled by the toolAllowList setting.',
    );
    assert.equal(ran, false);
  });

  it('allows a tool that is absent from the allow-list', async () => {
    let ran = false;
    const service = new BrudToolsService({
      getToolAllowList: () => ({ delete_file: false }),
    });

    service.registerTool('brud.reader', true, tool('read_file', () => {
      ran = true;
    }));

    const result = await service.executeTool('read_file', {}, CONTEXT);

    assert.equal(result.status, 'success');
    assert.equal(ran, true);
  });

  it('allows everything when the allow-list is empty', async () => {
    const service = new BrudToolsService({ getToolAllowList: () => ({}) });

    service.registerTool('brud.reader', true, tool('read_file', () => undefined));

    const result = await service.executeTool('read_file', {}, CONTEXT);

    assert.equal(result.status, 'success');
  });

  it('allows everything when no settings accessor is supplied', async () => {
    const service = new BrudToolsService();

    service.registerTool('brud.reader', true, tool('read_file', () => undefined));

    const result = await service.executeTool('read_file', {}, CONTEXT);

    assert.equal(result.status, 'success');
  });

  it('fails open when the settings accessor throws', async () => {
    const service = new BrudToolsService({
      getToolAllowList: () => {
        throw new Error('settings unavailable');
      },
    });

    service.registerTool('brud.reader', true, tool('read_file', () => undefined));

    const result = await service.executeTool('read_file', {}, CONTEXT);

    assert.equal(result.status, 'success');
  });
});

describe('BrudTools allow-list kernel wiring', () => {
  let workspaceRoot = '';

  before(async () => {
    workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'brud-allowlist-')));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  function caller(overrides?: Partial<ServiceContext>): ServiceContext {
    return {
      callerId: 'kernel',
      tier: 'kernel',
      workspaceRoot,
      ...overrides,
    };
  }

  it('reflects a live settings update through brud.core.settings.reader', async () => {
    const kernel = createStandardKernel({
      history: { inMemory: true },
      settings: { store: new InMemoryConfigStore() },
    });

    await kernel.boot({ workspaceRoot });

    try {
      let ran = 0;
      const tools = kernel.requestAccess<IBrudToolsService>(
        caller({ callerId: 'test', tier: 'core' }),
        BrudToolsToken,
      );

      tools.registerTool('brud.filesystem', true, tool('create_file', () => {
        ran += 1;
      }));

      const first = await tools.executeTool('create_file', {}, {
        workspaceRoot,
        callerId: 'test',
      });

      assert.equal(first.status, 'success');
      assert.equal(ran, 1);

      const settings = kernel.requestAccess(caller(), SettingsToken);
      await settings.update('user', { toolAllowList: { create_file: false } });

      const second = await tools.executeTool('create_file', {}, {
        workspaceRoot,
        callerId: 'test',
      });

      assert.equal(second.status, 'failed');
      assert.match(String(second.error), /^TOOL_DISABLED: tool "create_file"/);
      assert.equal(ran, 1);
    } finally {
      await kernel.shutdown();
    }
  });
});