# Brud daemon and DaemonClient

The daemon is a **pure host**: it hosts kernels and knows no participant and no
domain concept. Everything domain-specific comes from the operator's
`daemon.json` (see `examples/daemon/`) and from client boot options.

## Protocol methods

| Method | Purpose |
|:---|:---|
| `daemon.connect`, `daemon.ping`, `daemon.info` | Handshake, liveness, daemon facts |
| `kernel.requirements` | The startup fields a client may set (the operator's `clientOptions`) |
| `kernel.boot` | Boot a kernel from the operator composition; returns an instance id |
| `kernel.attach`, `kernel.list`, `kernel.status`, `kernel.dispose` | Manage kernel instances |
| `kernel.kinds` | Operation kinds the composition's participants own |
| `kernel.route` | Route a `[BRUD]` wrapper through the kernel's `syntax.route` exposure |
| `request.cancel` | Cancel an in-flight request; the reply is `request.cancelled` |

Kernel instances belong to the connection that booted them. Each kernel keeps
its state under `<home>/kernels/<name>/`; kernels booted with identical options
get separate state folders (`<key>`, `<key>-1`, ...). Authentication and the
caller tier (`ui` or `ai`) are fixed by the Noise session, never by request
parameters; the tier maps to host-session capabilities in `daemon.json`.

## DaemonClient

```ts
import { connectToDaemon } from '@brud/daemon';

const client = await connectToDaemon({ home, tier: 'ui', spawnIfMissing: true });
const boot = await client.request('kernel.boot', { options: { 'workspace.root': root } });
const routed = await client.request('kernel.route', { instanceId: boot.instanceId, text });
await client.close();
```

`client.request(method, params, options)` accepts an abort signal and a timeout;
`client.cancel(id)` sends `request.cancel`. A cancelled operation reports
status `aborted` (the Router passes all four statuses `success`, `failed`,
`aborted`, `skipped` through unchanged).
