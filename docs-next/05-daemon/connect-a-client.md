# Connect a client

This page shows how to connect to a running daemon, boot a kernel, and route Brud text through it.

Connect, boot, route, then close:

```js
import { connectToDaemon } from '@brud/daemon';

const client = await connectToDaemon({ home, tier: 'ui' });
const boot = await client.request('kernel.boot', { options: {} });
const instanceId = boot.instance.instanceId;
const routed = await client.request('kernel.route', { instanceId, text });
await client.close();
```

Note `boot.instance.instanceId`: the id sits inside `instance`.

The tier (`ui` or `ai`) is fixed by the authenticated session. A request cannot claim another tier.

## A complete, runnable demo

[`daemon-demo.mjs`](../examples/daemon-demo.mjs) creates a daemon in-process, connects, lists requirements, boots, lists kinds, routes two note operations and disposes. Run it from the `examples` folder with `node daemon-demo.mjs`.

## Typical flow

1. `kernel.requirements` shows which fields you may set.
2. `kernel.boot` with `{ options }` returns the instance and `reused`. A missing required startup field refuses the boot with an error naming the field and the participant.
3. `kernel.kinds` lists what the composition understands.
4. `kernel.route` with `{ instanceId, text }` runs Brud syntax.
5. `kernel.dispose` when finished. Kernels belong to the connection that booted them.

`client.request(method, params, options)` accepts an abort signal and a timeout. `client.cancel(id)` sends a cancellation.

**Next:** [Protocol reference](protocol-reference.md)
