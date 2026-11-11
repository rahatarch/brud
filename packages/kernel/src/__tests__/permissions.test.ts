import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../../src/contracts/handler.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import type { IBrudToolsService, IPluginExecutionContext } from '../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../services/BrudTools/descriptor/tokens.js';
import type { IBrudPlugin } from '../../services/PluginManager/contracts/IBrudPlugin.js';
import type { PluginPermission } from '../../services/PluginManager/contracts/permissions.js';
import { bootRealKernel } from './support/realKernel.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const SENTINEL = 'handler-ran.txt';
const TOOL = 'acme.read_file';

interface PermissionPluginOptions {
  readonly id: string;
  readonly permissions: readonly PluginPermission[];
  readonly requiredPermissions?: readonly string[];
  readonly resultFile: string;
  readonly override?: Partial<IPluginExecutionContext>;
  readonly input?: Record<string, unknown>;
  readonly attemptExecution: boolean;
}

function permissionPlugin(options: PermissionPluginOptions): IBrudPlugin {
  return {
    manifest: {
      id: options.id,
      name: options.id,
      version: '1.0.0',
      permissions: [...options.permissions],
    },
    activate: async (context): Promise<void> => {
      context.registerTool({
        name: TOOL,
        description: 'reads a file',
        parametersSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        ...(options.requiredPermissions === undefined
          ? {}
          : { requiredPermissions: options.requiredPermissions }),
        execute: async (input): Promise<OperationResult> => {
          await writeFile(join(context.workspaceRoot, SENTINEL), 'ran', 'utf8');
          return { status: 'success', data: input };
        },
      });

      if (options.attemptExecution) {
        const result = await context.executeTool(
          TOOL,
          options.input ?? { path: 'a.ts' },
          options.override,
        );

        await writeFile(join(context.workspaceRoot, options.resultFile), JSON.stringify(result), 'utf8');
      }
    },
  };
}

function caller(root: string): ServiceContext {
  return { callerId: 'permissions', tier: 'core', options: {...workspaceContextOptions(root)} };
}

async function readResult(path: string): Promise<OperationResult> {
  return JSON.parse(await readFile(path, 'utf8')) as OperationResult;
}

describe('requiredPermissions enforcement', () => {
  it('a plugin without fs:read cannot execute a tool that requires it', async (t) => {
    const resultFile = 'denied.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.denied',
      permissions: ['tools:register', 'tools:execute'],
      requiredPermissions: ['fs:read'],
      resultFile,
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-denied-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);
    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });

  it('a plugin with fs:read can execute the same tool', async (t) => {
    const resultFile = 'allowed.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.allowed',
      permissions: ['tools:register', 'tools:execute', 'fs:read'],
      requiredPermissions: ['fs:read'],
      resultFile,
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-allowed-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'success');
    assert.equal(await readFile(join(root, SENTINEL), 'utf8'), 'ran');
  });

  it('contextOverride cannot grant permissions', async (t) => {
    const resultFile = 'override.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.override',
      permissions: ['tools:register', 'tools:execute'],
      requiredPermissions: ['fs:read'],
      resultFile,
      override: { permissions: ['fs:read'] },
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-override-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);
    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });

  it('all required permissions are required', async (t) => {
    const resultFile = 'partial.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.partial',
      permissions: ['tools:register', 'tools:execute', 'fs:read'],
      requiredPermissions: ['fs:read', 'fs:write'],
      resultFile,
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-partial-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);
    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });

  it('an absent permission set fails closed', async (t) => {
    const plugin = permissionPlugin({
      id: 'acme.permissions.absent',
      permissions: ['tools:register', 'tools:execute'],
      requiredPermissions: ['fs:read'],
      resultFile: 'absent.json',
      attemptExecution: false,
    });
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-absent-',
      initialPlugins: [plugin],
    });

    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const result = await tools.executeTool(TOOL, { path: 'a.ts' }, {
      workspaceRoot: root,
      callerId: 'acme.permissions.absent',
    });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);
    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });

  it('a tool with no requiredPermissions is allowed', async (t) => {
    const resultFile = 'unrestricted.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.unrestricted',
      permissions: ['tools:register', 'tools:execute'],
      resultFile,
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-unrestricted-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'success');
    assert.equal(await readFile(join(root, SENTINEL), 'utf8'), 'ran');
  });

  it('the permission gate runs before the schema gate', async (t) => {
    const resultFile = 'gate-order.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.gate-order',
      permissions: ['tools:register', 'tools:execute'],
      requiredPermissions: ['fs:read'],
      resultFile,
      input: {},
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-gate-order-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /^TOOL_PERMISSION_DENIED: /);
    assert.doesNotMatch(String(result.error), /TOOL_VALIDATION_ERROR/);
    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });

  it('the error names the missing permission and the tool', async (t) => {
    const resultFile = 'message.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.message',
      permissions: ['tools:register', 'tools:execute'],
      requiredPermissions: ['fs:read'],
      resultFile,
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-message-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.match(String(result.error), /acme\.read_file/);
    assert.match(String(result.error), /fs:read/);
  });

  it('a denied call leaves no side effect on disk', async (t) => {
    const resultFile = 'no-side-effect.json';
    const plugin = permissionPlugin({
      id: 'acme.permissions.no-side-effect',
      permissions: ['tools:register', 'tools:execute'],
      requiredPermissions: ['fs:read'],
      resultFile,
      attemptExecution: true,
    });
    const { root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-side-effect-',
      initialPlugins: [plugin],
    });

    const result = await readResult(join(root, resultFile));

    assert.equal(result.status, 'failed');
    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });
});