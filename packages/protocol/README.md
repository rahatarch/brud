# @brud/protocol

Wire types, method names and error codes for the BrudOS daemon protocol: JSON-RPC 2.0 over a Noise-secured local channel. Protocol version `1.0.0`.

## Install

```bash
npm install @brud/protocol
```

Requires Node.js 22 or newer. This package has no runtime dependencies and ships CommonJS with TypeScript declarations.

## What it exports

- Method constants such as `KERNEL_BOOT`, `KERNEL_ROUTE` and `REQUEST_CANCEL`, with typed params and results.
- `RPC_ERROR_CODES` and the error types.
- `DAEMON_PROTOCOL_VERSION`.

```ts
import { KERNEL_BOOT, type KernelBootParams } from '@brud/protocol';
```

To run or connect to a daemon, use [`@brud/daemon`](https://www.npmjs.com/package/@brud/daemon).

## Documentation

[Protocol reference](https://github.com/rahatarch/brud/tree/main/docs-next/05-daemon/protocol-reference.md) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
