# Accept startup options

Let the host configure your participant at boot, for example with an `acme.greeting` value.

## Before you begin

Read [Boot and lifecycle](../03-concepts/boot-and-lifecycle.md) for how pruning works.

## Steps

1. **Declare the field.** Do this before the kernel reaches `RUNNING`, and use your own namespace: one segment such as `acme`, with field names like `acme.greeting` (`acme.notes` is not a valid namespace). A raw descriptor declares with `context.declareContextFields` and reads `context.options`; see [Raw descriptors](../03-concepts/boot-and-lifecycle.md#raw-descriptors).

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

   - `required: true` means the participant is pruned if the host does not supply the value.
   - Field types are `string`, `number`, `boolean` and `object`.

2. **Pass the value at boot.** The host sets it in the `options` bag of `bootKernel`.

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

3. **Read it at startup.** Use `ctx.bootOptions['acme.greeting']`, or `context.options['acme.greeting']` in a raw descriptor.

## Verify

Run `node startup-options.mjs`. The output is:

```text
with the option:    howdy, world
without the option: not available
kernel warnings:    yes
```

When the required value is missing, the kernel logs a warning and the participant's exposure does not exist. The kernel refuses to boot only if a hardcore or another participant depends on the pruned one.

## Next steps

- [Run the daemon](../05-daemon/run-the-daemon.md), where `clientOptions` controls which fields clients may set
