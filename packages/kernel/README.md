# @brud/kernel

The BrudOS kernel. It gives every participant an identity, lets each participant decide who may use its APIs, and enforces that on every call.

## Install

```bash
npm install @brud/kernel
```

Requires Node.js 22 or newer.

## What it contains

- **Boot:** `bootKernel(configPath, { options })` reads a composition (`brud.config.json`), verifies the seven hardcore services against pinned content hashes, admits participants, and returns a running kernel.
- **Host calls:** `kernel.runHostCall({ capabilities }, callback)` is how a host enters the kernel.
- **Hardcores:** identity registry, exposed API registry, parser, router, WASM cage, events and interception.
- **Types:** the contracts participants and hosts are written against.

## Quick start

Write a participant with [`@brud/sdk`](https://www.npmjs.com/package/@brud/sdk), list it in a `brud.config.json`, and boot it:

```js
import { bootKernel } from '@brud/kernel';

const kernel = await bootKernel('./brud.config.json', { options: {} });
// ... use the kernel inside kernel.runHostCall(...)
await kernel.shutdown();
```

A complete, tested example is in the [getting-started guide](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started).

## Notes

- The package includes prebuilt WASM cage binaries for Linux (x64, arm64), macOS (x64, arm64) and Windows (x64), so the install is large (about 47 MB unpacked).
- `@brud/kernel` is ESM only.

## Documentation

[BrudOS documentation](https://github.com/rahatarch/brud/tree/main/docs-next) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
