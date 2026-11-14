import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationResult } from '../contracts/handler.js';
import type { ServiceContext, IServiceLifecycle } from '../contracts/lifecycle.js';
import type { ServiceDescriptor } from '../contracts/serviceDescriptor.js';
import { createServiceToken } from '../contracts/serviceToken.js';
import { createStandardKernel } from './support/standardKernel.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import type { IBrudToolsService } from '../../../services/BrudTools/contracts/IBrudToolsService.js';
import { BrudToolsToken } from '../../../services/BrudTools/descriptor/tokens.js';
import { ParserToken } from '../../services/Parser/descriptor/tokens.js';
import type { IRouterService } from '../../services/Router/contracts/IRouterService.js';
import { ROUTER_CALLER_ID } from '../../services/Router/contracts/caller.js';
import {
  RouterKindCollisionError,
  RouterRegistrationClosedError,
} from '../../services/Router/contracts/errors.js';
import { RouterToken } from '../../services/Router/descriptor/tokens.js';
import { bootRealKernel } from './support/realKernel.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const PLUGIN_ID = 'acme.test.parser-router';

const ROUTE_DOCUMENT = [
  '[BRUD]',
  '[CALL tool route_echo]',
  'text: hello router',
  '[END]',
  '[CALL action route_echo_action]',
  'message: hello action',
  '[END]',
  '[/BRUD]',
].join('\n');

function routingPlugin(): IBrudPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Parser Router Probe',
      version: '1.0.0',
      permissions: ['tools:register', 'actions:register'],
    },
    activate(context): void {
      context.registerTool({
        name: 'route_echo',
        description: 'Echoes a tool payload.',
        parametersSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        execute: async (input): Promise<OperationResult> => ({
          status: 'success',
          data: { route: 'tool', text: input.text },
        }),
      });

      context.registerAction({
        name: 'route_echo_action',
        description: 'Echoes an action payload.',
        parametersSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        execute: async (input, executionContext): Promise<OperationResult> => ({
          status: 'success',
          data: {
            route: 'action',
            message: input.message,
            callerId: executionContext.callerId,
          },
        }),
      });
    },
  };
}

function caller(root: string): ServiceContext {
  return { callerId: 'kernel', tier: 'core', options: {...workspaceContextOptions(root)} };
}

describe('Parser and Router Level-1 services', () => {
  it('routes a tool operation to BrudTools and an action operation to ActionManager', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-parser-router-route-',
      initialPlugins: [routingPlugin()],
    });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);
    const tools = kernel.requestAccess<IBrudToolsService>(caller(root), BrudToolsToken);

    assert.equal('parseInput' in tools, false, 'BrudTools must not parse documents');
    assert.equal('parseAndRoute' in tools, false, 'BrudTools must not route documents');

    assert.deepEqual(
      [...router.registeredKinds()].sort(),
      ['action', 'tool'],
      'both Level-1 services claim their kind during boot',
    );
    assert.equal(router.isRegistrationOpen(), false, 'the boot window is sealed');

    const result = await router.route(ROUTE_DOCUMENT, {
      callerId: PLUGIN_ID,
      workspaceRoot: root,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.dispatched, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(
      result.operations.map((operation) => [operation.kind, operation.name, operation.status]),
      [
        ['tool', 'route_echo', 'success'],
        ['action', 'route_echo_action', 'success'],
      ],
    );
    assert.deepEqual(result.operations[0]?.result?.data, {
      route: 'tool',
      text: 'hello router',
    });
    assert.deepEqual(result.operations[1]?.result?.data, {
      route: 'action',
      message: 'hello action',
      callerId: PLUGIN_ID,
    });
  });

  it('rejects a late kind registration after the kernel is RUNNING', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-parser-router-late-',
    });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);

    assert.throws(
      () => router.register({
        kind: 'late',
        token: ParserToken,
        dispatch: async (): Promise<OperationResult> => ({ status: 'success' }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof RouterRegistrationClosedError);
        assert.equal(error.code, 'ROUTER_REGISTRATION_CLOSED');
        assert.equal(error.kind, 'late');
        return true;
      },
    );

    assert.equal(router.isRegistrationOpen(), false);
  });

  it('fails boot when two services claim the same kind', async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-parser-router-collision-')));

    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    interface RogueService extends IServiceLifecycle {
      registerWithRouter(router: IRouterService): void;
    }

    const rogueToken = createServiceToken<RogueService>(
      'test.rogue.tool',
      'Test-only service that contests the tool kind',
    );

    const rogueDescriptor: ServiceDescriptor<RogueService, RogueService> = {
      token: rogueToken,
      tier: 'core',
      dependencies: [],
      factory: (): RogueService => ({
        async initialize(): Promise<void> {
          return undefined;
        },
        async dispose(): Promise<void> {
          return undefined;
        },
        registerWithRouter(router: IRouterService): void {
          router.register<RogueService>({
            kind: 'tool',
            token: rogueToken,
            dispatch: async (): Promise<OperationResult> => ({ status: 'success' }),
          });
        },
      }),
    };

    const kernel = createStandardKernel({ history: { inMemory: true } });
    kernel.register(rogueDescriptor);

    await assert.rejects(
      kernel.boot({ options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        assert.ok(error instanceof RouterKindCollisionError);
        assert.equal(error.code, 'ROUTER_KIND_COLLISION');
        assert.equal(error.kind, 'tool');
        assert.equal(error.existingTokenId, rogueToken.id);
        return true;
      },
    );

    assert.equal(kernel.lifecycleState, 'DISPOSED');
  });

  it('uses the router caller identity for broker resolution', async (t) => {
    const { kernel, root } = await bootRealKernel(t, {
      prefix: 'brud-parser-router-caller-',
      initialPlugins: [routingPlugin()],
    });
    const router = kernel.requestAccess<IRouterService>(caller(root), RouterToken);

    // ActionManager's allowlist accepts only the router identity; a successful
    // action dispatch proves the broker request used it.
    const result = await router.route(
      [
        '[BRUD]',
        '[CALL action route_echo_action]',
        'message: identity check',
        '[END]',
        '[/BRUD]',
      ].join('\n'),
      { callerId: 'origin.caller', workspaceRoot: root },
    );

    assert.equal(RouterToken.id, 'brud.core.router');
    assert.equal(ROUTER_CALLER_ID, 'brud.core.router');
    assert.equal(result.status, 'success');
    assert.equal(
      (result.operations[0]?.result?.data as { readonly callerId?: unknown } | undefined)?.callerId,
      'origin.caller',
    );
  });
});
