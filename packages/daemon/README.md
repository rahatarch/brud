# @brud/daemon

A local background process that hosts BrudOS kernels and lets other programs (an editor, an AI agent, a script) use them over an authenticated connection.

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
| **`@brud/daemon`** (this package) | Run kernels as a local background process that editors, agents and scripts connect to. | `npm install @brud/daemon` |
| [`@brud/protocol`](https://www.npmjs.com/package/@brud/protocol) | The message types the daemon and its clients share. Installed with the daemon; you only need it directly to write your own client. | `npm install @brud/protocol` |

New to BrudOS? Start with the [introduction](https://github.com/rahatarch/brud/tree/main/docs-next/01-introduction/what-is-brudos.md) and the [getting-started guide](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started).

## Install

```bash
npm install @brud/daemon
```

Requires Node.js 22 or newer. It installs `@brud/kernel` and `@brud/protocol` for you.

## Run the daemon

```bash
npx brud-daemon --home ~/.brud --foreground
```

The daemon reads `<home>/daemon.json`, which names the composition to boot and which startup settings clients may change. It accepts connections only from the process that started it.

## Connect from your code

```js
import { connectToDaemon } from '@brud/daemon';

const client = await connectToDaemon({ home, tier: 'ui' });
const boot = await client.request('kernel.boot', { options: {} });
const routed = await client.request('kernel.route', {
  instanceId: boot.instance.instanceId,
  text, // a document in Brud text format
});
await client.close();
```

`tier` is `'ui'` or `'ai'`. The daemon decides what each tier may do, so an AI agent can be given less authority than a human-facing UI.

## Security

The connection is encrypted and authenticated with a per-tier token stored in an owner-only file. On Linux and macOS the daemon also checks the socket's owner and permissions. The caller's tier comes from the authenticated session, not from anything the caller claims. See the [security model](https://github.com/rahatarch/brud/tree/main/docs-next/06-security/security-model.md).

## Documentation

[Run the daemon](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/run-the-daemon.md) · [Connect a client](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/connect-a-client.md) · [Protocol reference](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/protocol-reference.md) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
