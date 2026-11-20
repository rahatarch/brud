# Boot and lifecycle

Boot is how a kernel goes from a config file to a running set of participants. This page describes the sequence, the lifecycle states, and how startup options reach your code.

## One sequence

Boot is a single, ordered sequence.

1. Read and validate the config.
2. Verify each hardcore against its pinned content hash.
3. Construct and initialize the hardcores, in order.
4. **Admit** the composed participants: validate manifests, issue identities, register exposures.
5. **Construct and initialize** participants in dependency order.
6. Enter `RUNNING`. Run each participant's `onRunning` hook.

If a hardcore is missing or broken, composed participants never start. If a composed participant fails to construct or initialize, everything that already started is rolled back and the boot fails.

## States

`UNINITIALIZED` then `BOOTING` then `RUNNING` then `SHUTTING_DOWN` then `DISPOSED`. Read the current one from `kernel.lifecycleState`.

## Admission and initialization fail differently

This is by design.

- **During admission**, a participant that nothing depends on can be **pruned**: left out, with a warning to the logger, and boot continues. The usual cause is a required startup field that was not supplied.
- **During construction and initialization**, any failure rolls back everything, hardcores included.

Admission decides *who participates*. Initialization decides *whether that set can finish starting*.

## Startup options

Hosts pass values to participants through the `options` bag in `bootKernel(configPath, { options })`. The kernel does not interpret them. A participant declares the fields it needs, inside its own namespace, and reads them back at startup.

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

The host supplies the value:

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

Output:

```text
with the option:    howdy, world
without the option: not available
kernel warnings:    yes
```

When the required field is missing, the participant is pruned: its exposure does not exist, so `resolve` returns `null`, and the kernel logs a warning. The kernel refuses the boot instead only if the pruned participant is a hardcore or something else depends on it.

Field types are `string`, `number`, `boolean` or `object`. A participant may only declare fields in its own namespace, and only before the kernel reaches `RUNNING`. The namespace is a single segment (letters, digits, `_` or `-`, starting with a letter), such as `acme`. Each field name is that namespace followed by a dot and a key, such as `acme.greeting`.

```js
context.declareContextFields('acme', [{ name: 'acme.greeting', type: 'string', required: false, description: 'Greeting text' }]);
```

`declareContextFields('acme.notes', …)` is rejected with `CONTEXT_CONTRACT_VIOLATION`.

### Raw descriptors

`defineParticipant` hands the values to you as `ctx.bootOptions`. A raw descriptor's `createService(context)` receives the same bag as `context.options`, and `context.declareContextFields` is available there too:

```js
export function createService(context) {
  context.declareContextFields('acme', [{ name: 'acme.limit', type: 'number', required: false, description: 'Limit' }]);
  const limit = context.options['acme.limit'] ?? 100;
  // …
}
```

## `onRunning` and `resolve`

A participant cannot resolve other participants' APIs while it is being constructed. The kernel is not running yet. When the kernel reaches `RUNNING`, each participant's `onRunning` hook fires and `ctx.resolve` becomes live. Before that, `ctx.resolve` returns `null`.

Call `ctx.resolve` lazily, when a method needs it, as in [Use another participant's API](../04-guides/use-another-participants-api.md).

## Shutdown

`kernel.shutdown()` moves to `SHUTTING_DOWN`, disposes participants, then reaches `DISPOSED`. Always shut down a kernel you booted. The test harness does it for you.

## Observations

The kernel records detailed denial reasons in an observation stream. Only the holder of the kernel object can read it, with `kernel.readObservations()`. A refused caller never sees the reason. The event names are listed in [`docs/kernel-api/catalogue/observations.md`](../../docs/kernel-api/catalogue/observations.md).

**Next:** [Hosts and host calls](hosts-and-host-calls.md)
