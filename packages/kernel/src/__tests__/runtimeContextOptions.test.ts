import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrudKernel } from '../engine/BrudKernel.js';
import { createServiceToken } from '../contracts/serviceToken.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import type { OperationHandler, OperationResult } from '../contracts/handler.js';
import { ContextContractError, requireContextString } from '../contracts/contextContract.js';

interface OptionProbe {
  workspaceRoot(): string;
  licenseKey(): unknown;
}

const PROBE_TOKEN = createServiceToken<OptionProbe>(
  'test.runtime.options.probe',
  'Runtime options probe',
);

function probeDescriptor(): ServiceDescriptor<OptionProbe> {
  return {
    token: PROBE_TOKEN,
    tier: 'core',
    dependencies: [],
    factory: (context: ServiceContext): OptionProbe => {
      const workspaceRoot = requireContextString(
        context.options,
        'workspace.root',
        PROBE_TOKEN.id,
      );

      return {
        workspaceRoot: (): string => workspaceRoot,
        licenseKey: (): unknown => context.options['licenseKey'],
      };
    },
  };
}

describe('runtime context options bag', () => {
  it('lets a service read the namespaced workspace root at runtime', async () => {
    const kernel = new BrudKernel();
    kernel.register(probeDescriptor());

    await kernel.boot({ options: { 'workspace.root': '/runtime/workspace' } });

    try {
      const caller: ServiceContext = {
        callerId: 'test.runtime',
        tier: 'core',
        options: { 'workspace.root': '/runtime/workspace' },
      };
      const service = kernel.requestAccess(caller, PROBE_TOKEN);

      assert.equal(service.workspaceRoot(), '/runtime/workspace');
    } finally {
      await kernel.shutdown();
    }
  });

  it('carries a hypothetical third-party option to a service and an operation without core knowledge', async () => {
    const kernel = new BrudKernel();
    let factoryBag: Readonly<Record<string, unknown>> | undefined;
    kernel.register({
      ...probeDescriptor(),
      factory: (context: ServiceContext): OptionProbe => {
        factoryBag = context.options;

        return {
          workspaceRoot: (): string => requireContextString(
            context.options,
            'workspace.root',
            PROBE_TOKEN.id,
          ),
          licenseKey: (): unknown => context.options['licenseKey'],
        };
      },
    });

    const handler: OperationHandler<void, unknown> = {
      kind: 'test_runtime_license',
      execute: async (ctx) => ({
        status: 'success',
        data: {
          licenseKey: ctx.options['licenseKey'],
          sameBag: ctx.options === factoryBag,
        },
      }),
    };
    kernel.operations.register(handler);

    await kernel.boot({
      options: { 'workspace.root': '/runtime/workspace', licenseKey: 'license-abc' },
    });

    try {
      const caller: ServiceContext = {
        callerId: 'test.runtime',
        tier: 'core',
        options: { 'workspace.root': '/runtime/workspace', licenseKey: 'license-abc' },
      };
      const service = kernel.requestAccess(caller, PROBE_TOKEN);
      assert.equal(service.licenseKey(), 'license-abc');

      const result = await kernel.execute<void, unknown>('test_runtime_license', undefined);
      assert.equal(result.status, 'success');
      assert.deepEqual(result.data, { licenseKey: 'license-abc', sameBag: true });
    } finally {
      await kernel.shutdown();
    }
  });

  it('throws a clear named error when a service-required option is absent', async () => {
    const kernel = new BrudKernel();
    kernel.register(probeDescriptor());

    await assert.rejects(
      kernel.boot({ options: {} }),
      (error: unknown) => {
        assert.ok(error instanceof ContextContractError);
        assert.equal(error.name, 'ContextContractError');
        assert.equal(error.field, 'workspace.root');
        assert.equal(error.service, 'test.runtime.options.probe');
        assert.match(error.message, /workspace\.root/u);
        return true;
      },
    );
  });

  it('does not synthesize a workspace when the boot bag is empty', async () => {
    const kernel = new BrudKernel();
    const observed: OperationResult<unknown>[] = [];
    kernel.operations.register({
      kind: 'test_empty_bag',
      execute: async (ctx) => {
        const result: OperationResult<unknown> = {
          status: 'success',
          data: Object.keys(ctx.options),
        };
        observed.push(result);
        return result;
      },
    });

    await kernel.boot({ options: {} });

    try {
      await kernel.execute<void, unknown>('test_empty_bag', undefined);
      assert.deepEqual(observed[0]?.status, 'success');
      assert.deepEqual(observed[0]?.data, []);
    } finally {
      await kernel.shutdown();
    }
  });
});