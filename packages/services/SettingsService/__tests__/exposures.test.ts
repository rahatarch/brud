import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootTestKernel } from '@brud/sdk/testing';
import { InMemoryConfigStore } from '../storage/InMemoryConfigStore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type Report = Record<string, unknown>;

function reports(): Record<string, Report> {
  return ((globalThis as { __settingsTest?: Record<string, Report> }).__settingsTest ??= {});
}

function probe(id: string, capabilities: readonly string[], body: string): string {
  return `const token = { id: ${JSON.stringify(id)}, description: 'settings probe', _brand: undefined };
const REGISTRY = { id: 'brud.core.exposedApiRegistry', description: 'registry', _brand: undefined };
const report = ((globalThis.__settingsTest ??= {})[token.id] ??= {});
export function createService() {
  return {
    token, tier: 'userland', dependencies: [],
    manifest: { requests: { capabilities: ${JSON.stringify(capabilities)} }, exposures: [], events: [] },
    factory: () => ({
      async onRunning(broker) {
        const registry = broker.requestAccess({ callerId: token.id, tier: 'userland', options: {} }, REGISTRY);
        ${body}
      },
    }),
  };
}
`;
}

const SURFACE = "(api) => api === null ? null : ['getSnapshot', 'onChange', 'update', 'reload'].filter((k) => typeof api[k] === 'function')";

describe('SettingsService on the v1 kernel (brud.settings@1, brud.settings.reader@1)', () => {
  it('serves both exposures, gates brud.settings by settings:read/settings:write, and the reader follows live changes', async (t) => {
    delete (globalThis as { __settingsTest?: unknown }).__settingsTest;

    await bootTestKernel(t, [
      { path: join(ROOT, 'serviceModule.ts') },
      { path: join(ROOT, 'settingsReader.ts') },
      { source: probe('acme.reader', [], `
        const surface = ${SURFACE};
        report.reader = surface(registry.resolve('brud.settings.reader'));
        report.settings = surface(registry.resolve('brud.settings'));
      `) },
      { source: probe('acme.writer', ['settings:read', 'settings:write'], `
        const surface = ${SURFACE};
        const settings = registry.resolve('brud.settings');
        const reader = registry.resolve('brud.settings.reader');
        report.settings = surface(settings);
        let seen = 0;
        const off = reader.onChange(() => { seen += 1; });
        await settings.update('user', { readConcurrency: 4 });
        report.notified = seen;
        report.readConcurrency = reader.getSnapshot().readConcurrency;
        off();
      `) },
    ], { 'settings.root': '/workspace', settings: { store: new InMemoryConfigStore() } });

    const all = reports();

    assert.deepEqual(all['acme.reader'], { reader: ['getSnapshot', 'onChange'], settings: null });
    assert.deepEqual(all['acme.writer'], { settings: ['getSnapshot', 'onChange', 'update', 'reload'], notified: 1, readConcurrency: 4 });
  });
});
