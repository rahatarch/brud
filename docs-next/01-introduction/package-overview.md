# Package overview

The core release is four npm packages. Install only what you need.

| You want to... | Install |
|---|---|
| Embed a kernel and write participants | `@brud/kernel` and `@brud/sdk` |
| Run kernels behind a local daemon | `@brud/daemon` (it brings `@brud/protocol`) |
| Write a client for the daemon | `@brud/daemon` (for `connectToDaemon`) and `@brud/protocol` (for types) |

## @brud/kernel

The engine and the seven hardcore services.

- `bootKernel(configPath, { options, logger })` reads a composition and returns a running kernel.
- The kernel object has `lifecycleState`, `requestAccess`, `runHostCall`, `readObservations` and `shutdown`.
- Contracts you build against: `ParticipantManifest`, `ServiceDescriptor`, `createServiceToken`, `withExposureBindings`, `ExposedApiRegistryToken`.
- `provisionIdentityRegistryStorage(path)` prepares the identity file a kernel needs.
- Import the other hardcores' contracts from `@brud/kernel/services/<Name>/index.js` (`Events`, `Interception`, `Parser`, `Router`, `WasmCage`).

The kernel has no runtime dependencies. It knows nothing about files, tools, workspaces or any other domain.

## @brud/sdk

The friendly way to write participants.

- `defineParticipant({...})` from `@brud/sdk/participant` builds a participant with an id, exposures and a `create` function. It handles tokens, manifests and bindings for you.
- `byCapability({...})` from the same entry point shapes a handle by the caller's capabilities.
- `bootTestKernel(t, entries)` from `@brud/sdk/testing` boots a real kernel for a test and cleans up afterwards.
- Plain-JSON helpers: `isPlainJson`, `assertPlain`, `assertName`, `assertMajor`.

`defineParticipant` covers exposures. If you need to own an operation kind or declare events and interceptions, write the descriptor by hand. [Own a kind](../04-guides/own-a-kind.md) shows how.

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
