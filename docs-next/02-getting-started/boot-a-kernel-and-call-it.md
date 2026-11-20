# Boot a kernel and call it

You will write a composition, boot a kernel, and call your greeter as a host.

**You will learn:** what a composition is, what `bootKernel` needs, what a host call is, and how to resolve an exposure.

## The code

```js
// boot-greeter.mjs
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
```

Run it from the folder that has `greeter.mjs`:

```bash
node boot-greeter.mjs
```

You should see:

```text
hello, world (asked by host)
```

## Step by step

**1. The hardcores.** The composition lists the seven hardcore services first, using the `kernel:serviceModules/<name>.js` form. The kernel will not boot without them. Their `official: true` is required. (A hardcore entry that says `official: false` fails boot.)

**2. Your participant.** Then comes your own module as an absolute path with `official: true`. In this beta a module that is not declared official is refused as native code.

**3. The identity registry file.** The kernel keeps issued identities in a file. `provisionIdentityRegistryStorage(path)` creates it, and the `'identity.registry.path'` boot option tells the kernel where it is. Keep this file outside any folder your participants can touch.

**4. `bootKernel(configPath, { options })`.** This reads the config, verifies the hardcores, starts everything and returns a running kernel. The `options` bag is how a host passes startup values to participants. The kernel does not interpret them. Each participant reads its own keys.

**5. The host call.** You are the *host*: the program outside the kernel. To use the kernel you must be inside a call chain the kernel recognises. `kernel.runHostCall({ capabilities }, fn)` starts one with origin `host` and the capabilities you declare. Here we declare none.

**6. Resolve, then use.** Inside the host call you ask the registry for the exposure. `kernel.requestAccess(...)` gives you the registry, and `registry.resolve('acme.greet')` returns your handle or `null` if the giver said no.

**7. Shut down.** `kernel.shutdown()` stops everything cleanly.

## Two things worth noticing

**Use the handle inside the host call.** Every use of a resolved handle is checked against the chain that makes the call. If you return the handle out of `runHostCall` and use it later, the call is refused with `EXPOSED_API_UNAVAILABLE`. Do your work inside.

**The greeting says "host".** Your `handle` saw `callerClass: 'host'`. You did not pass that in. The kernel put it there because the call began as a host call.

**Next:** [Own a kind and route text](own-a-kind-and-route-text.md)
