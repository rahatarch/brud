import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../contracts/handler.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type {
  IBrudToolsService,
  IPluginExecutionContext,
} from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import type { PluginPermission } from '../../../services/PluginManager/contracts/permissions.js';
import { bootRealKernel } from './support/realKernel.js';
import { ParserRouterHarness } from './support/parserRouterHarness.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const PLUGIN_ID = 'com.test.custom-plugin';
const TOOL_NAME = 'deploy_lambda';
const SENTINEL = 'deploy-lambda.json';

const RAW_DOCUMENT = [
  '[BRUD]',
  '[CALL deploy_lambda]',
  'region: us-east-1',
  'memory: 512',
  '{code}',
  'print("Hello from custom plugin")',
  '{/code}',
  '[END]',
  '[/BRUD]',
].join('\n');

const EXPECTED_PAYLOAD = {
  region: 'us-east-1',
  memory: 512,
  code: 'print("Hello from custom plugin")',
};

function customPlugin(
  permissions: readonly PluginPermission[] = ['tools:register', 'tools:execute'],
): IBrudPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Custom Lambda Deployer',
      version: '1.0.0',
      permissions: [...permissions],
    },
    activate: (context): void => {
      context.registerTool({
        name: TOOL_NAME,
        description: 'Deploys a Lambda function to a region.',
        parametersSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', enum: ['us-east-1'] },
            memory: {
              oneOf: [
                { type: 'integer', minimum: 128, maximum: 10240 },
                { type: 'string', pattern: '^[0-9]+$' },
              ],
            },
            code: { type: 'string', protected: true },
          },
          required: ['region', 'memory', 'code'],
        },
        requiredPermissions: ['tools:execute'],
        execute: async (input, executionContext): Promise<OperationResult> => {
          const memory = Number(input.memory);

          if (!Number.isSafeInteger(memory)) {
            return { status: 'failed', error: 'memory must be an integer' };
          }

          const payload = {
            region: String(input.region),
            memory,
            code: String(input.code),
          };

          await writeFile(
            join(executionContext.workspaceRoot, SENTINEL),
            JSON.stringify(payload),
            'utf8',
          );

          return { status: 'success', data: payload };
        },
      });
    },
  };
}

function serviceCaller(root: string): ServiceContext {
  return { callerId: 'e2e.third-party', tier: 'core', options: {...workspaceContextOptions(root)} };
}

function dispatchContext(root: string, plugin: IBrudPlugin): IPluginExecutionContext {
  return {
    workspaceRoot: root,
    callerId: plugin.manifest.id,
    permissions: [...plugin.manifest.permissions],
  };
}

describe('third-party plugin [BRUD] execution', () => {
  it('executes a real third-party tool from a raw [BRUD] document and writes the payload', async (t) => {
    const plugin = customPlugin();
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-e2e-third-party-',
      initialPlugins: [plugin],
    });
    const tools = kernel.requestAccess<IBrudToolsService>(serviceCaller(root), BrudToolsToken);
    const parserRouter = ParserRouterHarness.fromKernel(kernel, root);

    assert.equal(tools.getTool(TOOL_NAME)?.ownerPluginId, PLUGIN_ID);
    assert.equal(tools.getTool(TOOL_NAME)?.isOfficial, false);

    const routed = await parserRouter.parseAndRoute(RAW_DOCUMENT, {
      callerContext: dispatchContext(root, plugin),
    });

    assert.equal(routed.status, 'success');
    assert.equal(routed.dispatched, 1);
    assert.equal(routed.failed, 0);

    const outcome = routed.operations[0];

    assert.equal(outcome?.operationIndex, '1');
    assert.equal(outcome?.toolName, TOOL_NAME);
    assert.equal(outcome?.status, 'success');

    const written = JSON.parse(
      await readFile(join(root, SENTINEL), 'utf8'),
    ) as Record<string, unknown>;

    assert.deepEqual(written, EXPECTED_PAYLOAD);
    assert.deepEqual(outcome?.result?.data, EXPECTED_PAYLOAD);
  });

  it('rejects a caller without tools:execute with TOOL_PERMISSION_DENIED and no disk side effect', async (t) => {
    const plugin = customPlugin(['tools:register']);
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-e2e-third-party-denied-',
      initialPlugins: [plugin],
    });
    const tools = kernel.requestAccess<IBrudToolsService>(serviceCaller(root), BrudToolsToken);
    const parserRouter = ParserRouterHarness.fromKernel(kernel, root);

    assert.equal(tools.getTool(TOOL_NAME)?.ownerPluginId, PLUGIN_ID);

    const routed = await parserRouter.parseAndRoute(RAW_DOCUMENT, {
      callerContext: dispatchContext(root, plugin),
    });

    assert.equal(routed.status, 'failed');
    assert.equal(routed.failed, 1);

    const outcome = routed.operations[0];

    assert.equal(outcome?.status, 'failed');
    assert.match(String(outcome?.result?.error), /^TOOL_PERMISSION_DENIED: /);
    assert.match(String(outcome?.result?.error), /deploy_lambda/);
    assert.match(String(outcome?.result?.error), /tools:execute/);

    await assert.rejects(access(join(root, SENTINEL)), /ENOENT/);
  });
});
