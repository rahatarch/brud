# @brud/sdk

The BrudOS SDK: the friendly way to write and test participants for the BrudOS kernel.

## What is BrudOS?

BrudOS is a small kernel you embed in a program to build software out of independent pieces, called **participants**, that do not have to trust each other. The kernel gives every participant an identity, lets each participant decide who may call its APIs, and enforces that on every call.

The kernel has no abilities of its own: it does not read files, use the network or run commands. That makes it a good base for plugin systems and AI-agent runtimes, where you need to know exactly who was allowed to do what.

> **Status: beta (0.0.x).** The core works and is tested, but APIs may still change before 1.0.

## Which package do I need?

BrudOS is published as four packages. Install only what you need.

| Package | Use it to | Install |
|---|---|---|
| [`@brud/kernel`](https://www.npmjs.com/package/@brud/kernel) | The engine. Embed it in your program to run participants. | `npm install @brud/kernel` |
| **`@brud/sdk`** (this package) | Write and test participants (plugins, services, agent tools). | `npm install @brud/sdk @brud/kernel` |
| [`@brud/daemon`](https://www.npmjs.com/package/@brud/daemon) | Run kernels as a local background process that editors, agents and scripts connect to. | `npm install @brud/daemon` |
| [`@brud/protocol`](https://www.npmjs.com/package/@brud/protocol) | The message types the daemon and its clients share. Installed with the daemon; you only need it directly to write your own client. | `npm install @brud/protocol` |

New to BrudOS? Start with the [introduction](https://github.com/rahatarch/brud/tree/main/docs-next/01-introduction/what-is-brudos.md) and the [getting-started guide](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started).

## Install

```bash
npm install @brud/sdk @brud/kernel
```

Requires Node.js 22 or newer. `@brud/kernel` is a peer dependency, so install both.

## What you get

| Import | Use it for |
|---|---|
| `@brud/sdk/participant` | `defineParticipant` to describe a participant, and `byCapability` to give different callers different views of an API |
| `@brud/sdk/testing` | `bootTestKernel`, to run your participant on a real kernel inside a test |
| `@brud/sdk` | Small helpers for validating plain JSON |

## Example

A participant that offers one API, `acme.greet`:

```js
import { defineParticipant } from '@brud/sdk/participant';

export const createService = defineParticipant({
  id: 'acme.greeter',
  description: 'Says hello',
  create: () => ({ greet: (name) => `hello, ${name}` }),
  exposes: {
    'acme.greet': {
      version: 1,
      scope: 'any',
      handle: (caller, ctx) => ({ greet: (name) => ctx.instance.greet(name) }),
    },
  },
});
```

The participant that offers an API decides who may use it. Here `scope: 'any'` lets any participant call `acme.greet`, and `byCapability` lets you hand different callers different handles. To run it, list the file in a `brud.config.json` and boot it with `@brud/kernel`. The [tutorial](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started/your-first-participant.md) walks through it end to end.

## Documentation

[Getting started](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started) · [Concepts](https://github.com/rahatarch/brud/tree/main/docs-next/03-concepts) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
