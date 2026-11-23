# Package overview

The core release is five npm packages. Install only what you need.

| You want to... | Install |
|---|---|
| Embed a kernel and write participants | `@brud/kernel` and `@brud/sdk` |
| Scaffold, check, run, seal and package participants | `@brud/cli` |
| Run kernels behind a local daemon | `@brud/daemon` (it brings `@brud/protocol`) |
| Write a client for the daemon | `@brud/daemon` (for `connectToDaemon`) and `@brud/protocol` (for types) |

## @brud/kernel

The engine and the seven hardcore services.

- `bootKernel(configPath, { options, logger, seal })` reads a composition and returns a running kernel.
- The kernel object has `lifecycleState`, `requestAccess`, `runHostCall`, `readObservations`, `shutdown`, `abandoned` and `reload`.
- `createSeal(configPath, { out, cwd })` seals official participants into a reproducible seal with content digests.
- Contracts you build against: `ParticipantManifest`, `ServiceDescriptor`, `createServiceToken`, `withExposureBindings`, `ExposedApiRegistryToken`.
- `provisionIdentityRegistryStorage(path)` prepares the identity file a kernel needs.
- Import the other hardcores' contracts from `@brud/kernel/services/<Name>/index.js` (`Events`, `Interception`, `Parser`, `Router`, `WasmCage`).

The kernel has no runtime dependencies. It knows nothing about files, tools, workspaces or any other domain.

## @brud/sdk

The friendly way to write participants.

- `defineParticipant({...})` from `@brud/sdk/participant` builds a participant with an id, exposures, kinds, events, interceptions, interception points and a `create` function. It handles tokens, manifests and bindings for you.
- `byCapability({...})` from the same entry point shapes a handle by the caller's capabilities.
- `bootTestKernel(t, entries)` from `@brud/sdk/testing` boots a real kernel for a test and cleans up afterwards.
- Plain-JSON helpers: `isPlainJson`, `assertPlain`, `assertName`, `assertMajor`.

## @brud/cli

The command-line developer harness (`brud`).

- `brud init [name]` scaffolds projects (capability-gated, `--kind` text-routing, or `--guest` caged).
- `brud doctor [config]` and `brud check [config]` verify your environment and validate compositions (reporting missing options, unsealed participants, or left-out entries in `kernel.abandoned`).
- `brud run [config]` and `brud call <text>` route Brud documents directly or through the daemon.
- `brud kinds` and `brud inspect` list and probe kinds, exposures, requirements and caller access.
- `brud seal [config]` generates the cryptographic build seal for a composition's official participants.
- `brud pack [dir]` packages guest modules into WASM caged participants.

## @brud/daemon

A background process that hosts kernels for local clients.

- The `brud-daemon` command starts it. `createDaemon({ home })` starts it in code.
- `connectToDaemon({ home, tier })` returns a `DaemonClient` for talking to it.
- It reads an operator-owned `daemon.json` that decides what to boot, what clients may set, and what each caller tier may do.

It knows no domain concepts. See [the daemon](../05-daemon/README.md).

## @brud/protocol

Pure types and constants for the daemon's wire protocol: method names like `kernel.boot`, request and result types, error codes, and the JSON-RPC framing types. It has no runtime dependencies.

The package also still exports older message types used by editor integrations. They are unrelated to the daemon protocol and you can ignore them.

**Next:** [Install](../02-getting-started/install.md)
