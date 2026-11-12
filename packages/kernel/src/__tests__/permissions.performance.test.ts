import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../contracts/handler.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { IBrudToolsService } from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import { bootRealKernel } from './support/realKernel.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const NO_PERMISSIONS = 'perf.no_permissions';
const WITH_PERMISSIONS = 'perf.with_permissions';
const BATCHES = 10;
const BATCH_SIZE = 1_000;
const WARMUP = 2_000;

function plugin(): IBrudPlugin {
  return {
    manifest: {
      id: 'acme.perf',
      name: 'perf',
      version: '1.0.0',
      permissions: ['tools:register', 'tools:execute', 'fs:read'],
    },
    activate: (context): void => {
      const schema: Record<string, unknown> = {
        type: 'object',
        properties: { value: { type: 'string' } },
      };
      const execute = async (): Promise<OperationResult> => ({ status: 'success' });

      context.registerTool({
        name: NO_PERMISSIONS,
        description: 'permission-free tool',
        parametersSchema: schema,
        execute,
      });
      context.registerTool({
        name: WITH_PERMISSIONS,
        description: 'permission-gated tool',
        parametersSchema: schema,
        requiredPermissions: ['fs:read'],
        execute,
      });
    },
  };
}

function caller(root: string): ServiceContext {
  return { callerId: 'performance', tier: 'core', options: {...workspaceContextOptions(root)} };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted[middle] ?? 0;
}

async function measureBatch(
  tools: IBrudToolsService,
  name: string,
  shared: { readonly workspaceRoot: string; readonly callerId: string; readonly permissions: readonly string[] },
  count: number,
): Promise<number> {
  const start = process.hrtime.bigint();

  for (let index = 0; index < count; index += 1) {
    const result = await tools.executeTool(name, {}, shared);

    if (result.status !== 'success') {
      throw new Error(`unexpected failure for ${name}: ${String(result.error)}`);
    }
  }

  return Number(process.hrtime.bigint() - start) / count;
}

describe('permission check performance', () => {
  it('the permission check adds less than a millisecond', { timeout: 120_000 }, async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-permissions-performance-',
      initialPlugins: [plugin()],
    });
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);
    const shared = {
      workspaceRoot: root,
      callerId: 'performance',
      permissions: ['fs:read'],
    };

    await measureBatch(tools, NO_PERMISSIONS, shared, WARMUP);
    await measureBatch(tools, WITH_PERMISSIONS, shared, WARMUP);

    const without: number[] = [];
    const withPermissions: number[] = [];

    for (let batch = 0; batch < BATCHES; batch += 1) {
      without.push(await measureBatch(tools, NO_PERMISSIONS, shared, BATCH_SIZE));
      withPermissions.push(await measureBatch(tools, WITH_PERMISSIONS, shared, BATCH_SIZE));
    }

    const medianWithout = median(without);
    const medianWith = median(withPermissions);

    assert.ok(medianWith < 1_000_000, `permission-gated median ${medianWith}ns exceeds 1ms`);
    assert.ok(
      medianWith - medianWithout < 1_000_000,
      `permission overhead ${medianWith - medianWithout}ns exceeds 1ms`,
    );
  });
});