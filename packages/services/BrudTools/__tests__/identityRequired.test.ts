import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toolsHandle } from '../descriptor/toolsExposure.js';
import { TOOLS_EXECUTE_CAPABILITY, TOOLS_REGISTER_CAPABILITY } from '../contracts/exposure.js';

const caller = (identity: string | null, callerClass: string, capabilities: readonly string[]) => ({
  callerClass,
  identity,
  official: false,
  origin: callerClass === 'host' ? 'host' : 'runtime',
  capabilities: new Set(capabilities),
});

const registrations: unknown[] = [];
const executions: unknown[] = [];
const instance = {
  registerTool: (...args: unknown[]) => { registrations.push(args); },
  executeTool: (...args: unknown[]) => { executions.push(args); return Promise.resolve({ status: 'success' }); },
};

function handleFor(c: ReturnType<typeof caller>): Record<string, (...args: unknown[]) => unknown> {
  return toolsHandle(c as never, { instance } as never) as never;
}

describe('BrudTools exposure — identity', () => {
  it('refuses to register a tool for a caller without a kernel-issued identity', () => {
    const handle = handleFor(caller(null, 'host', [TOOLS_REGISTER_CAPABILITY]));

    assert.throws(() => handle.registerTool?.({ name: 'x' }), /kernel-issued identity/u);
    assert.equal(registrations.length, 0);
  });

  it('registers a tool under the caller identity', () => {
    const handle = handleFor(caller('id.owner', 'participant', [TOOLS_REGISTER_CAPABILITY]));

    handle.registerTool?.({ name: 'x' });

    assert.equal((registrations[0] as unknown[])[0], 'id.owner');
  });

  it('runs host-session executions as `host` and refuses an identity-less participant', async () => {
    await handleFor(caller(null, 'host', [TOOLS_EXECUTE_CAPABILITY])).executeTool?.('t', {}, {});
    assert.equal(((executions[0] as unknown[])[2] as { callerId: string }).callerId, 'host');

    assert.throws(
      () => handleFor(caller(null, 'participant', [TOOLS_EXECUTE_CAPABILITY])).executeTool?.('t', {}, {}),
      /needs a kernel-issued identity/u,
    );
  });
});
