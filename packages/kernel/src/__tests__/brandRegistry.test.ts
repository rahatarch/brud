import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { bootKernel, createStandardKernel } from '../bootstrap/index.js';
import type { ServiceContext } from '../contracts/lifecycle.js';
import type { ServiceToken } from '../contracts/serviceToken.js';
import type { IBrandRegistry } from '../../../services/BrandRegistry/contracts/IBrandRegistry.js';
import { BrandRegistryToken } from '../../../services/BrandRegistry/contracts/tokens.js';
import type { IBrudPlugin } from '../../../services/PluginManager/contracts/IBrudPlugin.js';
import { PLUGIN_MANAGER_SCOPE_NAME } from '../../../services/PluginManager/serviceModule.js';
import { workspaceContextOptions } from './support/workspaceContext.js';

const REGISTRY_SLOT = 'brud.core.brandRegistry.instance';

function caller(root: string): ServiceContext {
  return { callerId: 'brand.test', tier: 'core', options: {...workspaceContextOptions(root)} };
}

function serviceToken<T>(id: string): ServiceToken<T> {
  return { id, description: id, _brand: [] as unknown as readonly [T] };
}

async function tempWorkspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brud-brand-registry-'));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return root;
}

async function writeConfig(root: string, services: readonly string[]): Promise<string> {
  const configPath = join(root, 'brud.config.json');

  await writeFile(configPath, JSON.stringify({
    services: [
      { path: 'kernel:serviceModules/identityRegistry.js', official: true },
      { path: 'kernel:serviceModules/exposedApiRegistry.js', official: true },
      ...services.map((path) => ({ path, official: true })),
    ],
    plugins: [],
  }, null, 2));

  return configPath;
}

interface SyntheticModuleOptions {
  readonly id: string;
  readonly scopeName: string;
  readonly dependsOn?: string;
  readonly otherScopeName?: string;
  readonly publishItem?: boolean;
  readonly consumeItem?: boolean;
}

interface SyntheticProof {
  readonly ownScopeName: string;
  readonly ownVerified: boolean;
  readonly otherScopeVerified: boolean;
  readonly publishedItemVerifiedByOwner: boolean;
}

async function writeSyntheticModule(
  root: string,
  options: SyntheticModuleOptions,
): Promise<string> {
  const modulePath = join(root, `${options.id.replaceAll('.', '_')}.mjs`);
  const dependencyIds = [
    'brud.core.brandRegistry',
    ...(options.dependsOn === undefined ? [] : [options.dependsOn]),
  ];
  const body = `
const token = { id: ${JSON.stringify(options.id)}, description: ${JSON.stringify(options.id)}, _brand: [] };
const dependencies = ${JSON.stringify(dependencyIds)}.map((id) => ({
  id,
  description: id,
  _brand: [],
}));

export function createService(context) {
  return {
    token,
    tier: 'core',
    dependencies,
    factory: () => {
      const registry = context.shared[${JSON.stringify(REGISTRY_SLOT)}];

      if (registry === undefined) {
        throw new Error('brand registry was not constructed first');
      }

      const scope = registry.createScope(${JSON.stringify(options.scopeName)});
      let proof;
      ${options.publishItem === true ? `
      const item = { owner: ${JSON.stringify(options.id)} };
      scope.brand(item);
      context.shared['synthetic.item'] = { owner: ${JSON.stringify(options.id)}, scope, item };
      ` : ''}
      ${options.consumeItem === true ? `
      const published = context.shared['synthetic.item'];
      const ownItem = { owner: ${JSON.stringify(options.id)} };
      scope.brand(ownItem);
      proof = {
        ownScopeName: scope.name,
        ownVerified: scope.verify(ownItem),
        otherScopeVerified: published === undefined
          ? true
          : scope.verify(published.item),
        publishedItemVerifiedByOwner: published === undefined
          ? false
          : published.scope.verify(published.item),
      };
      ` : ''}
      return {
        scopeName: scope.name,
        proof,
        initialize() {},
        dispose() {},
      };
    },
  };
}
`;

  await writeFile(modulePath, body);

  return modulePath;
}

describe('Brand Registry in a booted kernel', () => {
  it('is present after standard boot and refuses late scope creation', async (t) => {
    const root = await tempWorkspace(t);
    const kernel = createStandardKernel({ history: { inMemory: true } });

    t.after(async () => {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    });

    await kernel.boot({ options: {...workspaceContextOptions(root), history: { inMemory: true } } });

    const registry = kernel.requestAccess<IBrandRegistry>(caller(root), BrandRegistryToken);

    assert.ok(registry.listScopeNames().includes(PLUGIN_MANAGER_SCOPE_NAME));
    assert.throws(
      () => registry.createScope('acme.late.scope'),
      (error: unknown) => {
        assert.equal((error as Error).name, 'BrandRegistryClosedError');
        return true;
      },
    );
  });

  it('fails boot when two services register the same scope name', async (t) => {
    const root = await tempWorkspace(t);
    const first = await writeSyntheticModule(root, {
      id: 'test.scope.first',
      scopeName: 'acme.shared.scope',
    });
    const second = await writeSyntheticModule(root, {
      id: 'test.scope.second',
      scopeName: 'acme.shared.scope',
    });
    const configPath = await writeConfig(root, [
      '@brud/service-brand-registry/serviceModule.js',
      first,
      second,
    ]);

    await assert.rejects(
      bootKernel(configPath, { options: {...workspaceContextOptions(root)} }),
      (error: unknown) => {
        assert.equal((error as Error).name, 'DuplicateBrandScopeError');
        assert.match((error as Error).message, /acme\.shared\.scope/u);
        return true;
      },
    );
  });

  it('lets a synthetic third-party service create, brand, and verify independently', async (t) => {
    const root = await tempWorkspace(t);
    const first = await writeSyntheticModule(root, {
      id: 'test.thirdParty.first',
      scopeName: 'acme.service.first',
      publishItem: true,
    });
    const second = await writeSyntheticModule(root, {
      id: 'test.thirdParty.second',
      scopeName: 'acme.service.second',
      dependsOn: 'test.thirdParty.first',
      otherScopeName: 'acme.service.first',
      consumeItem: true,
    });
    const configPath = await writeConfig(root, [
      '@brud/service-brand-registry/serviceModule.js',
      first,
      second,
    ]);
    const kernel = await bootKernel(configPath, { options: {...workspaceContextOptions(root)} });

    t.after(async () => {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    });

    const proof = kernel.requestAccess<{ readonly proof: SyntheticProof }>(
      caller(root),
      serviceToken('test.thirdParty.second'),
    ).proof;

    assert.deepEqual(proof, {
      ownScopeName: 'acme.service.second',
      ownVerified: true,
      otherScopeVerified: false,
      publishedItemVerifiedByOwner: true,
    });
  });

  it('certifies only plugins declared official through the plugin manager scope', async (t) => {
    const official: IBrudPlugin = {
      manifest: {
        id: 'acme.brand.official',
        name: 'official',
        version: '1.0.0',
        permissions: [],
      },
      activate: (): void => undefined,
    };
    const unofficial: IBrudPlugin = {
      manifest: {
        id: 'acme.brand.unofficial',
        name: 'unofficial',
        version: '1.0.0',
        permissions: [],
      },
      activate: (): void => undefined,
    };
    const root = await tempWorkspace(t);
    const kernel = createStandardKernel({
      history: { inMemory: true },
      'pluginManager.plugins': { entries: [official] },
      'pluginManager.certifyPlugins': true,
    });

    t.after(async () => {
      if (kernel.lifecycleState === 'RUNNING') {
        await kernel.shutdown().catch(() => undefined);
      }
    });

    await kernel.boot({ options: {...workspaceContextOptions(root), history: { inMemory: true } } });

    const registry = kernel.requestAccess<IBrandRegistry>(caller(root), BrandRegistryToken);
    const scope = registry.getScope(PLUGIN_MANAGER_SCOPE_NAME);

    assert.ok(scope !== undefined);
    assert.equal(scope.verify(official), true);
    assert.equal(scope.verify(unofficial), false);
  });
});
