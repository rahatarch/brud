import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootKernel, provisionIdentityRegistryStorage, ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;
const hardcores = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

async function boot(extraOptions) {
  const state = await mkdtemp(join(tmpdir(), 'brud-options-'));
  const configPath = join(state, 'brud.config.json');
  const registryFile = join(state, 'identity.json');
  const warnings = [];

  await writeFile(configPath, JSON.stringify({
    services: [...hardcores, { path: join(here, 'configurable-greeter.mjs'), official: true }],
  }));
  provisionIdentityRegistryStorage(registryFile);

  const kernel = await bootKernel(configPath, {
    options: { 'identity.registry.path': registryFile, ...extraOptions },
    logger: { warn: (message) => warnings.push(message) },
  });

  const answer = kernel.runHostCall({ capabilities: [] }, () => {
    const registry = kernel.requestAccess({ callerId: 'my.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    const greeter = registry.resolve('acme.configurable');

    return greeter === null ? 'not available' : greeter.greet('world');
  });

  await kernel.shutdown();

  return { answer, warnings };
}

console.log('with the option:   ', (await boot({ 'acme.greeting': 'howdy' })).answer);

const without = await boot({});

console.log('without the option:', without.answer);
console.log('kernel warnings:   ', without.warnings.length > 0 ? 'yes' : 'none');
