# @brud/protocol

The message types, method names and error codes that the BrudOS daemon and its clients use to talk to each other.

## What is BrudOS?

BrudOS is a small kernel you embed in a program to build software out of independent pieces, called **participants**, that do not have to trust each other. The kernel gives every participant an identity, lets each participant decide who may call its APIs, and enforces that on every call.

The kernel has no abilities of its own: it does not read files, use the network or run commands. That makes it a good base for plugin systems and AI-agent runtimes, where you need to know exactly who was allowed to do what.

> **Status: beta (0.0.x).** The core works and is tested, but APIs may still change before 1.0.

## Which package do I need?

BrudOS is published as four packages. Install only what you need.

| Package | Use it to | Install |
|---|---|---|
| [`@brud/kernel`](https://www.npmjs.com/package/@brud/kernel) | The engine. Embed it in your program to run participants. | `npm install @brud/kernel` |
| [`@brud/sdk`](https://www.npmjs.com/package/@brud/sdk) | Write and test participants (plugins, services, agent tools). | `npm install @brud/sdk @brud/kernel` |
| [`@brud/daemon`](https://www.npmjs.com/package/@brud/daemon) | Run kernels as a local background process that editors, agents and scripts connect to. | `npm install @brud/daemon` |
| **`@brud/protocol`** (this package) | The message types the daemon and its clients share. Installed with the daemon; you only need it directly to write your own client. | `npm install @brud/protocol` |

New to BrudOS? Start with the [introduction](https://github.com/rahatarch/brud/tree/main/docs-next/01-introduction/what-is-brudos.md) and the [getting-started guide](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started).

## Do I need this?

Usually not. If you run the daemon or connect to it with [`@brud/daemon`](https://www.npmjs.com/package/@brud/daemon), this package is installed for you. Install it directly only if you are writing your own daemon client and want the TypeScript types.

## Install

```bash
npm install @brud/protocol
```

Requires Node.js 22 or newer. It has no runtime dependencies and ships CommonJS with TypeScript declarations.

## What it exports

- Method name constants such as `KERNEL_BOOT`, `KERNEL_ROUTE` and `REQUEST_CANCEL`, with typed parameters and results.
- `RPC_ERROR_CODES` and the error types.
- `DAEMON_PROTOCOL_VERSION` (currently `1.0.0`, the version of the wire protocol, which is separate from this package's version).

```ts
import { KERNEL_BOOT, type KernelBootParams } from '@brud/protocol';
```

The messages are JSON-RPC 2.0 sent over a Noise-encrypted local channel.

## Documentation

[Protocol reference](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/protocol-reference.md) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
