# BrudOS

[![npm](https://img.shields.io/npm/v/@brud/kernel?label=%40brud%2Fkernel)](https://www.npmjs.com/package/@brud/kernel)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/rahatarch/brud/releases)

**A small kernel for building software out of parts that do not have to trust each other.**

BrudOS is a kernel you embed in a Node.js program. You build your software as independent pieces called **participants**. The kernel gives every participant an identity, lets each participant decide who may use its APIs, and enforces that on every call.

The kernel has no abilities of its own: it does not read files, use the network or run commands. Everything useful is a participant. That makes it a good base for plugin systems, tool hosts and AI-agent runtimes, where you need to know exactly who was allowed to do what.

## Why BrudOS

- **Identity you cannot forge.** Every participant gets its identity from the kernel. Nobody can claim to be someone else.
- **Every API has an owner.** The participant that offers an API decides who may call it and what each caller receives. The kernel enforces that answer.
- **No shared internals.** Participants reach each other only through declared APIs, never by importing each other's code.
- **Untrusted code stays caged.** A participant that is not declared official runs inside a WebAssembly sandbox with no access to the operating system.
- **Small enough to understand.** The kernel is a handful of core services, with no runtime dependencies.

## Packages

| Package | Use it to |
|:--|:--|
| [`@brud/kernel`](https://www.npmjs.com/package/@brud/kernel) | Embed the kernel and run participants |
| [`@brud/sdk`](https://www.npmjs.com/package/@brud/sdk) | Write and test participants |
| [`@brud/daemon`](https://www.npmjs.com/package/@brud/daemon) | Host kernels in a local background process that editors, agents and scripts connect to |
| [`@brud/protocol`](https://www.npmjs.com/package/@brud/protocol) | The message types shared by the daemon and its clients |

Requires Node.js 22 or newer. Prebuilt sandbox binaries are included for Linux (x64, arm64), macOS (x64, arm64) and Windows (x64).

## Quick start

```bash
npm install @brud/kernel @brud/sdk
```

Write a participant that offers one API, `acme.greet`:

```js
// greeter.mjs
import { defineParticipant } from '@brud/sdk/participant';

class Greeter {
  greet(name) {
    return `hello, ${name}`;
  }
}

export const createService = defineParticipant({
  id: 'acme.greeter',
  description: 'Says hello',
  create: () => new Greeter(),
  exposes: {
    'acme.greet': {
      version: 1,
      scope: 'any',
      handle: (caller, ctx) => ({
        greet: (name) => `${ctx.instance.greet(name)} (asked by ${caller.callerClass})`,
      }),
    },
  },
});
```

Boot a kernel that runs it, and call the API as a host:

```js
// boot.mjs
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootKernel,
  provisionIdentityRegistryStorage,
  ExposedApiRegistryToken,
} from '@brud/kernel';

const state = await mkdtemp(join(tmpdir(), 'brud-hello-'));
const hardcores = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));

const configPath = join(state, 'brud.config.json');
await writeFile(configPath, JSON.stringify({
  services: [...hardcores, { path: join(import.meta.dirname, 'greeter.mjs'), official: true }],
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

```bash
node boot.mjs
# hello, world (asked by host)
```

The [getting-started tutorials](docs-next/02-getting-started) explain every line, then show how to accept text commands, test a participant against a real kernel, and run it all behind the daemon.

## Running as a daemon

The daemon boots kernels from an operator-owned composition and serves them to other programs over an authenticated, encrypted local connection. UIs and AI agents get separate caller tiers, so an agent can be given less authority than a human-facing UI.

```bash
npm install @brud/daemon
npx brud-daemon --home ~/.brud --foreground
```

See [Run the daemon](docs-next/05-daemon/run-the-daemon.md) and [Connect a client](docs-next/05-daemon/connect-a-client.md).

## Documentation

- [BrudOS documentation](docs-next): introduction, tutorials, concepts, guides, daemon, security and reference.
- [What is BrudOS?](docs-next/01-introduction/what-is-brudos.md) and [Core ideas](docs-next/01-introduction/core-ideas.md)
- [Security model](docs-next/06-security/security-model.md)
- [ARCHITECTURE.md](ARCHITECTURE.md): layers, invariants and call routing.
- [PRIVACY.md](PRIVACY.md): local-first guarantees and data handling.
- [CONTRIBUTING.md](CONTRIBUTING.md): repository layout, tests and pull requests.
- [Releases](https://github.com/rahatarch/brud/releases) and the [changelog](CHANGELOG.md)

## License

[Apache License 2.0](LICENSE)
