# @brud/kernel

The BrudOS kernel: boots a set of participants, gives each one an identity, and enforces who may call what.

## What is BrudOS?

BrudOS is a small kernel you embed in a program to build software out of independent pieces, called **participants**, that do not have to trust each other. The kernel gives every participant an identity, lets each participant decide who may call its APIs, and enforces that on every call.

The kernel has no abilities of its own: it does not read files, use the network or run commands. That makes it a good base for plugin systems and AI-agent runtimes, where you need to know exactly who was allowed to do what.

> **Status: beta (0.0.x).** The core works and is tested, but APIs may still change before 1.0.

## Which package do I need?

BrudOS is published as four packages. Install only what you need.

| Package | Use it to | Install |
|---|---|---|
| **`@brud/kernel`** (this package) | The engine. Embed it in your program to run participants. | `npm install @brud/kernel` |
| [`@brud/sdk`](https://www.npmjs.com/package/@brud/sdk) | Write and test participants (plugins, services, agent tools). | `npm install @brud/sdk @brud/kernel` |
| [`@brud/daemon`](https://www.npmjs.com/package/@brud/daemon) | Run kernels as a local background process that editors, agents and scripts connect to. | `npm install @brud/daemon` |
| [`@brud/protocol`](https://www.npmjs.com/package/@brud/protocol) | The message types the daemon and its clients share. Installed with the daemon; you only need it directly to write your own client. | `npm install @brud/protocol` |

New to BrudOS? Start with the [introduction](https://github.com/rahatarch/brud/tree/main/docs-next/01-introduction/what-is-brudos.md) and the [getting-started guide](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started).

## Install

```bash
npm install @brud/kernel
```

Requires Node.js 22 or newer. The package is ESM only.

## What you get

- **`bootKernel(configPath, { options })`** reads a composition (a small `brud.config.json` listing the participants to run), checks the seven built-in core services against pinned content hashes, starts your participants, and returns a running kernel.
- **`kernel.runHostCall({ capabilities }, callback)`** is how your program makes calls into the kernel.
- **`kernel.shutdown()`** stops it.
- **Types** for writing participants. In practice you will write them with [`@brud/sdk`](https://www.npmjs.com/package/@brud/sdk).

## Quick start

```js
import { bootKernel } from '@brud/kernel';

const kernel = await bootKernel('./brud.config.json', { options: {} });
// make calls inside kernel.runHostCall(...)
await kernel.shutdown();
```

A kernel needs a composition and at least one participant, so the fastest way to a working example is the tested tutorial: [Boot a kernel and call it](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started/boot-a-kernel-and-call-it.md).

## Good to know

- The package bundles prebuilt WebAssembly sandbox binaries for Linux (x64, arm64), macOS (x64, arm64) and Windows (x64). Untrusted participants run inside that sandbox. This makes the install large (about 47 MB unpacked).
- The kernel has no runtime dependencies.

## Documentation

[BrudOS documentation](https://github.com/rahatarch/brud/tree/main/docs-next) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
