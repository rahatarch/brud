# Install

This page installs the BrudOS core packages and checks that they work.

## What you need

- **Node.js 22 or newer.** The project is built and tested on Node 22.
- A package manager. The examples use `npm`.
- An empty folder to work in.

## Install the packages

For embedding a kernel and writing participants:

```bash
npm install @brud/kernel @brud/sdk
```

If you also want the daemon:

```bash
npm install @brud/daemon
```

Create `package.json` with `"type": "module"` or use the `.mjs` extension for your files. The examples use `.mjs`.

## Check that it works

Create `check.mjs`:

```js
import { bootKernel } from '@brud/kernel';

console.log(typeof bootKernel);
```

Run it:

```bash
node check.mjs
```

You should see `function`. If you see an import error instead, see [Troubleshooting](../07-reference/troubleshooting.md).

## Working inside the BrudOS repository

If you are working from a clone of the repository instead:

```bash
npm ci
npm run build:protocol && npm run build:kernel && npm run build:sdk && npm run build:daemon
```

The workspace links `@brud/*` for you, and the samples in [`../examples/`](../examples/README.md) run directly.

Starting a project? [`brud init`](the-brud-cli.md) creates one that already passes `brud doctor` and `npm test`.

**Next:** [Your first participant](your-first-participant.md)
