# @brud/daemon

A local host for BrudOS kernels. The daemon boots kernels from an operator-owned composition and lets other programs (an editor, an AI agent, a script) use them over an authenticated local connection.

## Install

```bash
npm install @brud/daemon
```

Requires Node.js 22 or newer.

## Run

```bash
brud-daemon --home ~/.brud --foreground
```

The daemon reads `<home>/daemon.json`, which names the composition to boot and which startup fields clients may set. It admits only the process that started it.

## Connect

```js
import { connectToDaemon } from '@brud/daemon';

const client = await connectToDaemon({ home, tier: 'ui' });
const boot = await client.request('kernel.boot', { options: {} });
const routed = await client.request('kernel.route', {
  instanceId: boot.instance.instanceId,
  text,
});
await client.close();
```

## Security

The channel is Noise NNpsk0 keyed by a per-tier token written owner-only. On POSIX the socket's ownership and mode are verified. The caller tier (`ui` or `ai`) comes from the authenticated session. See the [security model](https://github.com/rahatarch/brud/tree/main/docs-next/06-security/security-model.md).

## Documentation

[Run the daemon](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/run-the-daemon.md) · [Protocol reference](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/protocol-reference.md) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
