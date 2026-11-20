import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExposedApiRegistryToken, bootKernel, provisionIdentityRegistryStorage } from '@brud/kernel';
import { workspaceContextOptions } from '../../../kernel/src/__tests__/support/workspaceContext.js';

const SERVICES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARDCORES = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));
const COMPOSED = ['SettingsService/serviceModule.ts', 'SettingsService/settingsReader.ts', 'WorkspaceService/serviceModule.ts', 'ValidationService/serviceModule.ts', 'BrudFileSystem/serviceModule.ts', 'BrudTools/serviceModule.ts']
  .map((path) => ({ path: join(SERVICES, path), official: true }));

/** A participant that registers one tool which uses another service. */
const TOOLSMITH = `
const token = { id: 'acme.toolsmith', description: 'toolsmith', _brand: undefined };
const REGISTRY = { id: 'brud.core.exposedApiRegistry', description: 'registry', _brand: undefined };
const OFFICIAL = { policyVersion: 2, official: true };
let fs;
export function createService() {
  return { token, tier: 'userland', dependencies: [],
    manifest: {
      requests: { capabilities: ['tools:register', 'fs:read'] },
      exposures: [
        { name: 'acme.exists', version: 1, scope: 'any', policy: OFFICIAL },
        { name: 'acme.kind', version: 1, scope: 'any', policy: OFFICIAL },
      ],
      kinds: [{ kind: 'acme', exposure: 'acme.kind' }],
      events: [],
    },
    factory: () => {
      const instance = { async onRunning(broker) {
        const registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
        fs = registry.resolve('brud.filesystem');
        registry.resolve('brud.tools').registerTool({
          name: 'acme.exists', description: 'exists', exposure: 'acme.exists',
          parametersSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        });
      } };
      Object.defineProperty(instance, 'provideExposure', { enumerable: false, value: (name) => {
        if (name === 'acme.exists') {
          return { projection: () => ({ execute: async (input, context) => { let exists; try { exists = await fs.exists(input.path); } catch (error) { exists = 'refused'; } return { status: 'success', data: { exists, callerId: context.callerId, permissions: context.permissions } }; } }) };
        }
        if (name === 'acme.kind') {
          return { projection: () => ({ dispatch: (operation, context) => ({ status: 'success', data: { name: operation.name, caller: context.caller.callerClass } }) }) };
        }
        return undefined;
      } });
      return instance;
    } };
}`;

const BLOCK = (name: string, body: string): string => `[BRUD]\n[CALL tool ${name}]\n${body}\n[END]\n[/BRUD]`;

describe('Brud Syntax: host → syntax.route@1 → kind owner → tool', () => {
  it('routes on the kernel call chain with a kernel-derived caller', async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'brud-syntax-')));
    const workspace = join(root, 'ws');
    await mkdir(workspace);
    await writeFile(join(workspace, 'a.txt'), 'a', 'utf8');
    const toolsmith = join(root, 'toolsmith.mjs');
    await writeFile(toolsmith, TOOLSMITH, 'utf8');
    const identity = join(root, 'identity.json');
    provisionIdentityRegistryStorage(identity);
    const config = join(root, 'brud.config.json');
    await writeFile(config, JSON.stringify({ services: [...HARDCORES, ...COMPOSED, { path: toolsmith, official: true }] }), 'utf8');
    const kernel = await bootKernel(config, { options: { ...workspaceContextOptions(workspace), 'identity.registry.path': identity, 'router.root': workspace } });
    t.after(async () => {
      await kernel.shutdown();
      await rm(root, { recursive: true, force: true });
    });

    const route = (text: string, capabilities: readonly string[]): Promise<unknown> => kernel.runHostCall({ capabilities }, () => {
      const registry = kernel.requestAccess({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
      const syntax = registry.resolve<{ route(text: string): Promise<unknown> }>('syntax.route');
      assert.ok(syntax !== null, 'syntax.route@1 must resolve for a host session');

      return syntax.route(text);
    });

    const ok = await route(BLOCK('acme.exists', 'path: a.txt'), ['tools:execute']) as { status: string; operations: { result?: { data?: Record<string, unknown> } }[] };
    assert.equal(ok.status, 'success');
    const data = ok.operations[0]?.result?.data ?? {};
    assert.equal(data.callerId, 'host', 'caller id comes from the call chain, not the request');
    assert.deepEqual(data.permissions, ['tools:execute']);
    // The tool runs as its owner; the giver's scope and policy still decide.
    // brud.filesystem was widened to scope any (2026-11-20), so a host-started
    // request reaches it through an owner holding fs:read.
    assert.equal(data.exists, true);

    // A kind declared in the manifest (works the same for caged participants).
    const declared = await route('[BRUD]\n[CALL acme hello]\nx: 1\n[END]\n[/BRUD]', []) as { status: string; operations: { result?: { data?: Record<string, unknown> } }[] };
    assert.equal(declared.status, 'success');
    assert.deepEqual(declared.operations[0]?.result?.data, { name: 'hello', caller: 'host' });

    // A host session (non-official) cannot reach the dispatch exposure directly.
    const direct = await kernel.runHostCall({ capabilities: ['tools:execute'] }, () => kernel
      .requestAccess({ callerId: 'acme.host', tier: 'core', options: {} }, ExposedApiRegistryToken)
      .resolve('brud.tools.dispatch'));
    assert.equal(direct, null);
  });
});
