# Accept startup options

**Goal:** let the host pass `acme.greeting` when booting.

1. Declare the field, in your own namespace, before `RUNNING`:

```js
// configurable-greeter.mjs
import { defineParticipant } from '@brud/sdk/participant';

const define = defineParticipant({
  id: 'acme.configurable',
  create: (ctx) => {
    // Startup options the host passed to bootKernel arrive in ctx.bootOptions.
    const greeting = String(ctx.bootOptions['acme.greeting'] ?? 'hello');

    return { greet: (name) => `${greeting}, ${name}` };
  },
  exposes: {
    'acme.configurable': {
      scope: 'any',
      handle: (_caller, ctx) => ({ greet: (name) => ctx.instance.greet(name) }),
    },
  },
});

export function createService(context) {
  // Declare the startup field this participant needs, inside its own namespace.
  context.declareContextFields('acme', [
    {
      name: 'acme.greeting',
      type: 'string',
      required: true,
      description: 'The word used to greet people.',
    },
  ]);

  return define(context);
}
```

2. The host passes it in `bootKernel(configPath, { options })`:

```js
// startup-options.mjs
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
```

If a required field is missing, the participant is pruned (warning logged) unless a hardcore or another participant depends on it. Details: [Boot and lifecycle](../03-concepts/boot-and-lifecycle.md).
