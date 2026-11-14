import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardKernel } from './support/standardKernel.js';
import { ContextContractError } from '../contracts/contextContract.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import { createServiceToken } from '../contracts/serviceToken.js';
import type { BrudOperation } from '../../services/Parser/contracts/index.js';
import { FileSystemToken } from '../../../services/BrudFileSystem/descriptor/tokens.js';
import type { IBrudFileSystem } from '../../../services/BrudFileSystem/contracts/index.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import { RouterService } from '../../services/Router/orchestrator/RouterService.js';
import type { BrudRouteRegistration } from '../../services/Router/contracts/types.js';
import { SettingsToken } from '../../../services/SettingsService/descriptor/tokens.js';
import type { ISettingsService } from '../../../services/SettingsService/contracts/ISettingsService.js';
import { identityRegistryContextOptions } from './support/workspaceContext.js';

interface MigratedField {
  readonly field: string;
  readonly service: string;
}

const MIGRATED_FIELDS: readonly MigratedField[] = [
  { field: 'settings.root', service: 'settings' },
  { field: 'filesystem.root', service: 'filesystem' },
  { field: 'terminal.root', service: 'terminal' },
  { field: 'pluginManager.root', service: 'pluginManager' },
  { field: 'history.root', service: 'history' },
  { field: 'router.root', service: 'router' },
  { field: 'identity.registry.path', service: 'identity' },
];

let root = '';

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brud-migrated-context-')));
  await mkdir(join(root, 'home'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function contextBag(workspaceRoot: string): Record<string, unknown> {
  return {
    'workspace.root': workspaceRoot,
    'settings.root': workspaceRoot,
    'filesystem.root': workspaceRoot,
    'terminal.root': workspaceRoot,
    'pluginManager.root': workspaceRoot,
    'history.root': workspaceRoot,
    'router.root': workspaceRoot,
    ...identityRegistryContextOptions(workspaceRoot),
  };
}

function caller(options: Readonly<Record<string, unknown>>, callerId = 'brud.host.daemon'): ServiceContext {
  return { callerId, tier: 'core', options };
}

function createKernel() {
  return createStandardKernel({
    history: { inMemory: true },
    settings: { homeDirectory: join(root, 'home') },
  });
}

describe('migrated context fields', () => {
  it('declares every migrated namespace in the schema', async () => {
    const bag = contextBag(root);
    const kernel = createKernel();

    await kernel.boot({ options: bag });

    try {
      const schema = kernel.getContextSchema();

      for (const expected of MIGRATED_FIELDS) {
        const field = schema.fields.find((entry) => entry.name === expected.field);

        assert.ok(field, `missing schema field ${expected.field}`);
        assert.equal(field.service, expected.service);
        assert.equal(field.type, 'string');
        assert.equal(field.required, true);
      }

      assert.equal(schema.fields.some((entry) => entry.name === 'workspace.root'), true);
    } finally {
      await kernel.shutdown();
    }
  });

  it('fails boot when any migrated field is missing, naming the service and field', async () => {
    for (const expected of MIGRATED_FIELDS) {
      const bag = contextBag(root);
      delete bag[expected.field];
      const kernel = createKernel();

      await assert.rejects(
        kernel.boot({ options: bag }),
        (error: unknown) => {
          assert.ok(error instanceof ContextContractError);
          assert.equal(error.field, expected.field);
          assert.equal(error.service, expected.service);
          assert.equal(error.expectedType, 'string');
          assert.match(error.message, new RegExp(expected.field.replace('.', '\\.'), 'u'));
          assert.match(error.message, new RegExp(`"${expected.service}"`, 'u'));
          return true;
        },
        `booting without ${expected.field} should fail`,
      );
    }
  });

  it('boots with namespaced keys only and services read them at runtime', async () => {
    const bag = contextBag(root);
    const activatedRoots: string[] = [];
    const plugin: IBrudPlugin = {
      manifest: {
        id: 'acme.context.probe',
        name: 'Context probe',
        version: '1.0.0',
        permissions: [],
      },
      activate: (context): void => {
        activatedRoots.push(context.workspaceRoot);
      },
    };
    const kernel = createStandardKernel({
      history: { inMemory: true },
      settings: { homeDirectory: join(root, 'home') },
      'pluginManager.plugins': { entries: [plugin] },
    });

    await kernel.boot({ options: bag });

    try {
      assert.deepEqual(activatedRoots, [root]);

      const fileSystem = kernel.requestAccess<IBrudFileSystem>(
        caller(bag),
        FileSystemToken,
      );
      await fileSystem.writeAtomic('context-probe.txt', 'namespaced');

      assert.equal(await readFile(join(root, 'context-probe.txt'), 'utf8'), 'namespaced');

      const settings = kernel.requestAccess<ISettingsService>(
        caller(bag),
        SettingsToken,
      );
      await settings.update('workspace', { readConcurrency: 9 });

      const written = JSON.parse(
        await readFile(join(root, '.brud', 'settings.json'), 'utf8'),
      ) as { readConcurrency?: number };

      assert.equal(written.readConcurrency, 9);
    } finally {
      await kernel.shutdown();
    }
  });
});

describe('router namespaced root', () => {
  it('reads router.root at dispatch time when the request omits a root', async () => {
    const targetToken = createServiceToken<{ ping(): string }>(
      'test.router.target',
      'Router dispatch target',
    );
    const seenRoots: string[] = [];
    const registration: BrudRouteRegistration<{ ping(): string }> = {
      kind: 'test_query',
      token: targetToken,
      dispatch: async (_service, _operation, context) => {
        seenRoots.push(context.workspaceRoot);

        return { status: 'success', data: 'ok' };
      },
    };
    const operation: BrudOperation = {
      index: '1',
      kind: 'test_query',
      name: 'probe',
      parameters: {},
    };
    const broker = {
      requestAccess: <T>(): T => ({ ping: (): string => 'pong' }) as T,
      hasService: (): boolean => true,
      listServices: (): readonly never[] => [],
    };
    const parser = {
      parse: () => ({ ok: true as const, operations: [operation] }),
    };
    const router = new RouterService({
      broker,
      callerContext: {
        callerId: 'test.router',
        tier: 'core',
        options: { 'router.root': '/router/workspace' },
      },
      getParser: () => parser as never,
    });

    router.register(registration);
    router.closeRegistration();

    const result = await router.route('[BRUD]ignored[/BRUD]');

    assert.equal(result.status, 'success');
    assert.deepEqual(seenRoots, ['/router/workspace']);
  });
});