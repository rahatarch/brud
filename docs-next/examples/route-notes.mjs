import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootKernel, provisionIdentityRegistryStorage, ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;

const state = await mkdtemp(join(tmpdir(), 'brud-note-'));
const hardcores = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));
const configPath = join(state, 'brud.config.json');
await writeFile(configPath, JSON.stringify({ services: [...hardcores, { path: join(here, 'notes.mjs'), official: true }] }));
const registryFile = join(state, 'identity.json');
provisionIdentityRegistryStorage(registryFile);
const kernel = await bootKernel(configPath, { options: { 'identity.registry.path': registryFile } });

const text = `[BRUD]
[CALL note add]
text: buy milk
[END]
[CALL note add]
text: call Sam
[END]
[CALL note list]
[END]
[/BRUD]`;

const result = await kernel.runHostCall({ capabilities: [] }, async () => {
  const registry = kernel.requestAccess({ callerId: 'my.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
  const syntax = registry.resolve('syntax.route');
  return { routed: await syntax.route(text), kinds: syntax.kinds() };
});
console.log(JSON.stringify(result.routed, null, 1).slice(0, 900));
console.log(JSON.stringify(result.kinds));
await kernel.shutdown();
