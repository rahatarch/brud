/**
 * Goal 7 — multi-workspace isolation.
 *
 * One real daemon process (in-process server, real Unix socket) serves two
 * workspaces. Each workspace owns an independent kernel, tool registry, MCP
 * bridge and history ledger.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Protocol from '@brud/protocol';
import type { OperationResult } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { IBrudPlugin } from '@brud/service-plugin-manager' with { 'resolution-mode': 'import' };
import { WorkspaceRegistry } from '../workspaceRegistry.js';
import { DaemonServer } from '../server/DaemonServer.js';
import { attachMcpTransports } from '../mcpTransport.js';
import {
  INITIALIZE_PARAMS,
  REPO_ROOT,
  connectSocketClient,
  createWorkspace,
  endpointOf,
  postMcp,
} from './support/harness.js';
import type { DaemonClient } from '../client/DaemonClient.js';

function syntheticPlugin(id: string, toolName: string): IBrudPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '0.0.1',
      permissions: ['tools:register'],
    },
    activate(context): void {
      context.registerTool({
        name: toolName,
        description: `Synthetic ${toolName}`,
        parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (): Promise<OperationResult> => ({
          status: 'success',
          message: `from ${toolName}`,
        }),
      });
    },
  };
}

async function loadPluginFactory<T>(packageName: string, factoryName: string): Promise<T> {
  const entry = pathToFileURL(
    resolve(REPO_ROOT, 'packages', 'plugins', packageName, 'dist', 'index.js'),
  ).href;
  const module = await import(entry) as Record<string, unknown>;
  const factory = module[factoryName];

  if (typeof factory !== 'function') {
    throw new Error(`${packageName} does not export ${factoryName}`);
  }

  return factory as T;
}

interface MultiDaemon {
  readonly registry: WorkspaceRegistry;
  readonly server: DaemonServer;
  readonly rootA: string;
  readonly rootB: string;
  readonly clientA: DaemonClient;
  readonly clientB: DaemonClient;
  readonly socketDir: string;
  shutdown(): Promise<void>;
}

interface MultiDaemonOptions {
  readonly prefix: string;
  readonly withFilesystem?: boolean;
}

async function startMultiDaemon(options: MultiDaemonOptions): Promise<MultiDaemon> {
  const bridgeFactory = await loadPluginFactory<() => IBrudPlugin>(
    'MCPBridge',
    'createMcpBridgePlugin',
  );
  const filesystemFactory = options.withFilesystem === true
    ? await loadPluginFactory<() => IBrudPlugin>('Filesystem', 'createFilesystemPlugin')
    : undefined;

  const registry = new WorkspaceRegistry({
    initialPlugins: [],
    certifyInitialPlugins: true,
    idleTimeoutMs: 0,
    onWorkspaceSpawned: (workspace) => attachMcpTransports(workspace, {
      stdio: false,
      logger: { warn: (): void => undefined },
    }),
    logger: { warn: (): void => undefined },
  });
  const rootA = await createWorkspace(`${options.prefix}a-`);
  const rootB = await createWorkspace(`${options.prefix}b-`);
  const pluginsA: IBrudPlugin[] = [
    syntheticPlugin('test.multi.a', 'workspace_a_tool'),
    ...(filesystemFactory === undefined ? [] : [filesystemFactory()]),
    bridgeFactory(),
  ];
  const pluginsB: IBrudPlugin[] = [
    syntheticPlugin('test.multi.b', 'workspace_b_tool'),
    ...(filesystemFactory === undefined ? [] : [filesystemFactory()]),
    bridgeFactory(),
  ];

  await registry.spawn(rootA, pluginsA);
  await registry.spawn(rootB, pluginsB);

  const socketDir = await createWorkspace(`${options.prefix}socket-`);
  const socketPath = join(socketDir, 'd.sock');
  const token = randomBytes(32).toString('hex');
  const aiToken = randomBytes(32).toString('hex');
  const server = await DaemonServer.create({
    registry,
    socketPath,
    principals: { ui: token, ai: aiToken },
    workspaceRoot: rootA,
  });

  await server.listen();

  const endpoint = await endpointOf(rootA);
  const clientA = await connectSocketClient({ ...endpoint, socketPath }, token, rootA);
  const clientB = await connectSocketClient({ ...endpoint, socketPath }, token, rootB);

  return {
    registry,
    server,
    rootA,
    rootB,
    clientA,
    clientB,
    socketDir,
    shutdown: async (): Promise<void> => {
      await clientA.close().catch(() => undefined);
      await clientB.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await registry.disposeAll().catch(() => undefined);
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
      await rm(socketDir, { recursive: true, force: true });
    },
  };
}

async function listToolNames(client: DaemonClient): Promise<readonly string[]> {
  const result = await client.request<Protocol.ToolsListResult>(Protocol.TOOLS_LIST, {});

  return result.tools.map((tool) => tool.name);
}

interface HttpToolList {
  readonly name?: string;
}

async function listHttpTools(workspaceRoot: string): Promise<readonly HttpToolList[]> {
  const endpointFile = join(workspaceRoot, '.brud', 'mcp-endpoint.json');
  const endpoint = JSON.parse(await readFile(endpointFile, 'utf8')) as { readonly url: string };
  const initialized = await postMcp(endpoint.url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: INITIALIZE_PARAMS,
  });

  assert.equal(initialized.status, 200);
  const listed = await postMcp(endpoint.url, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });

  assert.equal(listed.status, 200);
  const body = JSON.parse(listed.text) as {
    readonly result?: { readonly tools?: readonly HttpToolList[] };
  };

  return body.result?.tools ?? [];
}

let daemon: MultiDaemon;

before(async () => {
  daemon = await startMultiDaemon({ prefix: 'brud-multi-', withFilesystem: true });
});

after(async () => {
  await daemon.shutdown();
});

describe('Goal 7 — per-workspace tool catalogs', () => {
  it('returns workspace A tools to client A', async () => {
    const names = await listToolNames(daemon.clientA);

    assert.ok(names.includes('workspace_a_tool'));
  });

  it('returns workspace B tools to client B', async () => {
    const names = await listToolNames(daemon.clientB);

    assert.ok(names.includes('workspace_b_tool'));
  });

  it('does not leak workspace B tools into workspace A', async () => {
    const names = await listToolNames(daemon.clientA);

    assert.equal(names.includes('workspace_b_tool'), false);
  });

  it('does not leak workspace A tools into workspace B', async () => {
    const names = await listToolNames(daemon.clientB);

    assert.equal(names.includes('workspace_a_tool'), false);
  });

  it('gives each workspace its own MCP HTTP bridge', async () => {
    const namesA = (await listHttpTools(daemon.rootA)).map((tool) => tool.name);
    const namesB = (await listHttpTools(daemon.rootB)).map((tool) => tool.name);

    assert.ok(namesA.includes('workspace_a_tool'));
    assert.equal(namesA.includes('workspace_b_tool'), false);
    assert.ok(namesB.includes('workspace_b_tool'));
    assert.equal(namesB.includes('workspace_a_tool'), false);
  });
});

describe('Goal 7 — filesystem and history isolation', () => {
  it('writes a tool call in A only to workspace A', async () => {
    const result = await daemon.clientA.request<Protocol.ToolsExecuteResult>(
      Protocol.TOOLS_EXECUTE,
      {
        name: 'create_file',
        input: { path: 'a-only.txt', content: 'only in A\n' },
      },
    );

    assert.equal(result.result.status, 'success', String(result.result.error));
    assert.equal(existsSync(join(daemon.rootA, 'a-only.txt')), true);
    assert.equal(existsSync(join(daemon.rootB, 'a-only.txt')), false);
  });
});

describe('Goal 7 — workspace disposal', () => {
  it('keeps B working after A is disposed', { timeout: 30_000 }, async () => {
    const pair = await startMultiDaemon({ prefix: 'brud-multi-dispose-a-' });

    try {
      await pair.registry.dispose(pair.rootA);
      const names = await listToolNames(pair.clientB);

      assert.ok(names.includes('workspace_b_tool'));
    } finally {
      await pair.shutdown();
    }
  });

  it('keeps A working after B is disposed', { timeout: 30_000 }, async () => {
    const pair = await startMultiDaemon({ prefix: 'brud-multi-dispose-b-' });

    try {
      await pair.registry.dispose(pair.rootB);
      const names = await listToolNames(pair.clientA);

      assert.ok(names.includes('workspace_a_tool'));
    } finally {
      await pair.shutdown();
    }
  });

  it('disposes an unused workspace on the idle sweep', { timeout: 30_000 }, async () => {
    const registry = new WorkspaceRegistry({
      initialPlugins: [],
      idleTimeoutMs: 0,
    });
    const root = await createWorkspace('brud-multi-idle-');

    try {
      await registry.spawn(root, [syntheticPlugin('test.multi.idle', 'idle_tool')]);
      assert.ok(registry.get(root));

      await registry.disposeIdle(0);
      assert.equal(registry.get(root), undefined);
    } finally {
      await registry.disposeAll().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});