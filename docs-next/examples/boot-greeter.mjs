import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootKernel,
  provisionIdentityRegistryStorage,
  ExposedApiRegistryToken,
} from '@brud/kernel';

const here = import.meta.dirname;

const state = await mkdtemp(join(tmpdir(), 'brud-hello-'));
const hardcores = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

const configPath = join(state, 'brud.config.json');
await writeFile(configPath, JSON.stringify({
  services: [...hardcores, { path: join(here, 'greeter.mjs'), official: true }],
}));

const registryFile = join(state, 'identity.json');
provisionIdentityRegistryStorage(registryFile);

const kernel = await bootKernel(configPath, {
  options: { 'identity.registry.path': registryFile },
});

const answer = kernel.runHostCall({ capabilities: [] }, () => {
  const registry = kernel.requestAccess(
    { callerId: 'my.host', tier: 'core', options: {} },
    ExposedApiRegistryToken,
  );
  const greeter = registry.resolve('acme.greet');
  return greeter === null ? 'refused' : greeter.greet('world');
});

console.log(answer);
await kernel.shutdown();
