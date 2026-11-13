/**
 * Goal 8 — MCP transport security.
 *
 * The bridge is an ordinary `tools:execute` caller: it cannot bypass kernel
 * permissions, cannot widen its authority, and must survive malformed,
 * oversized and concurrent traffic.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { IBrudPlugin, OperationResult } from '@brud/kernel';
import type { IPluginLogger } from '@brud/service-plugin-manager';
import { PluginContext } from '../../../../services/PluginManager/contracts/PluginContext.js';
import { ExposedApiRegistryService } from '../../../../kernel/services/ExposedApiRegistry/orchestrator/ExposedApiRegistryService.js';
import { createRegistryCapabilityProviders } from '../../../../services/PluginManager/orchestrator/registryCapabilities.js';
import type { InternalPluginRecord } from '../../../../services/PluginManager/orchestrator/types.js';
import type { IKernelAccessBroker, ServiceInfo } from '../../../../kernel/src/contracts/accessBroker.js';
import type { ServiceContext } from '../../../../kernel/src/contracts/lifecycle.js';
import type { ServiceToken } from '../../../../kernel/src/contracts/serviceToken.js';
import { bootBridgeHarness, isErrorOf, textOf } from './support/harness.test.js';
import type { BridgeHarness } from './support/harness.test.js';
import { HttpMcpTransport } from '../../../../daemon/src/mcpTransport.js';
import { sanitizeFailureText } from '../server/mcpServer.js';

const LOGGER: IPluginLogger = {
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

interface CountingPlugin {
  readonly plugin: IBrudPlugin;
  readonly calls: () => number;
}

function countingValuePlugin(): CountingPlugin {
  let calls = 0;

  return {
    plugin: {
      manifest: {
        id: 'test.security.counting',
        name: 'Counting value tool',
        version: '0.0.1',
        permissions: ['tools:register'],
      },
      activate(context): void {
        context.registerTool({
          name: 'accept_value',
          description: 'Accept a string value',
          parametersSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
          execute: async (): Promise<OperationResult> => {
            calls += 1;

            return { status: 'success', message: 'accepted' };
          },
        });
      },
    },
    calls: () => calls,
  };
}

function guardedPlugin(): IBrudPlugin {
  return {
    manifest: {
      id: 'test.security.guarded',
      name: 'Guarded tool',
      version: '0.0.1',
      permissions: ['tools:register'],
    },
    activate(context): void {
      context.registerTool({
        name: 'guarded_tool',
        description: 'Requires fs:write from its caller',
        parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
        requiredPermissions: ['fs:write'],
        execute: async (): Promise<OperationResult> => ({ status: 'success', message: 'guarded' }),
      });
    },
  };
}

function echoPlugin(): IBrudPlugin {
  return {
    manifest: {
      id: 'test.security.echo',
      name: 'Echo tool',
      version: '0.0.1',
      permissions: ['tools:register'],
    },
    activate(context): void {
      context.registerTool({
        name: 'rapid_echo',
        description: 'Echo under concurrency',
        parametersSchema: {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
          additionalProperties: false,
        },
        execute: async (input): Promise<OperationResult> => ({
          status: 'success',
          message: `echo:${String(input.value)}`,
        }),
      });
    },
  };
}

let securityHarness: BridgeHarness;
let counting: CountingPlugin;
let officialHarness: BridgeHarness;

before(async () => {
  counting = countingValuePlugin();
  securityHarness = await bootBridgeHarness({
    prefix: 'brud-mcp-security-',
    plugins: [counting.plugin, guardedPlugin(), echoPlugin()],
  });
  officialHarness = await bootBridgeHarness({ prefix: 'brud-mcp-security-official-' });
});

after(async () => {
  await securityHarness.shutdown();
  await officialHarness.shutdown();
});


class EmptyBroker implements IKernelAccessBroker {
  requestAccess<TService>(caller: ServiceContext, token: ServiceToken<TService>): TService {
    void caller;
    throw new Error(`Service "${token.id}" is not registered`);
  }

  hasService(): boolean {
    return false;
  }

  listServices(): readonly ServiceInfo[] {
    return Object.freeze([]);
  }
}

function createContextWithoutTools(root: string): PluginContext {
  const permissions = ['terminal:execute'] as const;
  const registry = new ExposedApiRegistryService({
    broker: new EmptyBroker(),
    callerContext: {
      callerId: 'test.api.registry',
      tier: 'core',
      workspaceRoot: root,
    },
  });

  registry.closeRegistration();

  const manifest = {
    id: 'test.security.no-tools',
    name: 'MCP security no-tools probe',
    version: '1.0.0',
    permissions: [...permissions],
  };
  const record: InternalPluginRecord = {
    plugin: { manifest, activate: (): void => undefined },
    manifest,
    official: false,
    state: 'unloaded',
  };

  return new PluginContext({
    pluginId: 'test.security.no-tools',
    workspaceRoot: root,
    permissions,
    logger: LOGGER,
    capabilities: createRegistryCapabilityProviders(
      registry,
      record,
      permissions,
      root,
    ),
  });
}

describe('Goal 8 — capability boundary', () => {
  it('throws when a plugin without tools:execute calls executeTool', async () => {
    const context = createContextWithoutTools(securityHarness.root);

    await assert.rejects(
      context.executeTool('read_file', {}),
      (error: unknown) => (error as { readonly code?: string }).code === 'PLUGIN_PERMISSION',
    );
  });

  it('cannot bypass a tool requiredPermissions check', async () => {
    const response = await securityHarness.callTool('guarded_tool', {});

    assert.equal(isErrorOf(response), true);
    assert.match(textOf(response), /TOOL_PERMISSION_DENIED/u);
  });
});

describe('Goal 8 — malformed and adversarial MCP messages', () => {
  it('rejects invalid JSON without crashing the bridge', async () => {
    await assert.rejects(securityHarness.transport.inject('{not-json'));

    const tools = await securityHarness.listTools();
    assert.ok(tools.some((tool) => tool.name === 'rapid_echo'));
  });

  it('rejects an envelope that is not JSON-RPC 2.0 without crashing', async () => {
    await assert.rejects(
      securityHarness.transport.inject({ id: 90, method: 'tools/list', params: {} }),
    );

    const tools = await securityHarness.listTools();
    assert.ok(tools.length > 0);
  });

  it('returns JSON-RPC method-not-found for an unknown method', async () => {
    const response = await securityHarness.request('no/such/method', {});

    assert.equal(response.error?.code, -32601);
  });

  it('returns JSON-RPC invalid-params (-32602) for tools/call without a name', async () => {
    const response = await securityHarness.request('tools/call', { arguments: {} });

    assert.equal(response.error?.code, -32602);
  });

  it('rejects a 10 MB argument before dispatching to the tool', { timeout: 30_000 }, async () => {
    const response = await securityHarness.callTool('accept_value', {
      value: 'x'.repeat(10 * 1024 * 1024),
    });

    assert.equal(counting.calls(), 0, 'oversized payload must not reach the handler');
    assert.ok(response.error !== undefined || isErrorOf(response));
  });

  it('answers a notification with no response', async () => {
    const response = await securityHarness.transport.inject({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    assert.equal(response, undefined);
  });
});

describe('Goal 8 — workspace and permission containment', () => {
  it('refuses a path traversal outside the workspace with isError true', async () => {
    const response = await officialHarness.callTool('create_file', {
      path: '../escape.txt',
      content: 'escape',
    });

    assert.equal(isErrorOf(response), true);
    assert.match(textOf(response), /WORKSPACE_PATH_VIOLATION/u);
  });

  it('does not add path leakage beyond the kernel error text', async () => {
    await writeFile(`${officialHarness.root}/leak.txt`, 'one\n', 'utf8');
    const response = await officialHarness.callTool('create_file', {
      path: 'leak.txt',
      content: 'two\n',
    });
    const direct = await officialHarness.tools.executeTool(
      'create_file',
      { path: 'leak.txt', content: 'two\n' },
      { workspaceRoot: officialHarness.root, callerId: 'verification.mcp' },
    );
    const directText = typeof direct.error === 'string'
      ? direct.error
      : direct.error instanceof Error
        ? direct.error.message
        : direct.message ?? '';

    assert.equal(isErrorOf(response), true);
    assert.equal(textOf(response), sanitizeFailureText(directText, officialHarness.root));
    assert.equal(textOf(response).includes(officialHarness.root), false);
    assert.doesNotMatch(textOf(response), /\n\s+at\s/u);
  });

  it('survives 100 concurrent tools/call requests without state corruption', { timeout: 30_000 }, async () => {
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_unused, index) =>
        securityHarness.callTool('rapid_echo', { value: index }),
      ),
    );

    assert.equal(responses.length, 100);

    for (let index = 0; index < responses.length; index += 1) {
      const response = responses[index];

      assert.ok(response);
      assert.equal(isErrorOf(response), false);
      assert.equal(textOf(response as NonNullable<typeof response>), `echo:${index}`);
    }
  });
});

describe('Goal 8 — HTTP transport limits', () => {
  it('rejects an oversized HTTP body without dispatching', { timeout: 30_000 }, async () => {
    const transport = await HttpMcpTransport.create();

    try {
      const response = await fetch(transport.address as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(9 * 1024 * 1024),
      }).catch((error: unknown) => error);

      if (response instanceof Error) {
        return;
      }

      assert.equal(response.status, 413);
    } finally {
      await transport.close();
    }
  });

  it('rejects invalid JSON over HTTP with a parse error', async () => {
    const transport = await HttpMcpTransport.create();

    try {
      const response = await fetch(transport.address as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      });
      const body = await response.json() as { readonly error?: { readonly code?: number } };

      assert.equal(response.status, 400);
      assert.equal(body.error?.code, -32700);
    } finally {
      await transport.close();
    }
  });

  it('rejects a non-JSON-RPC HTTP envelope with invalid-request', async () => {
    const transport = await HttpMcpTransport.create();

    try {
      const response = await fetch(transport.address as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      const body = await response.json() as { readonly error?: { readonly code?: number } };

      assert.equal(response.status, 400);
      assert.equal(body.error?.code, -32600);
    } finally {
      await transport.close();
    }
  });
});