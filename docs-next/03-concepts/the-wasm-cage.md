# The WASM cage

The cage is the hardcore that runs untrusted code in isolation.

## Status in this beta

Be clear about what ships. A module not declared official is refused as native code. The cage primitive exists and is verified, but it is a building block, not a finished plugin system. This page describes only what is verified.

## How a participant reaches the cage

Participant code that is not official cannot be a plain JavaScript module. It must be a **participant package**: a folder with a `brud.participant.json` and a compiled `.wasm` module. List the manifest in the composition and leave it not official:

```json
{ "path": "./caged-tasks/brud.participant.json", "official": false }
```

```json
{
  "format": 1,
  "id": "acme.caged",
  "manifest": {
    "requests": { "capabilities": [] },
    "exposures": [{ "name": "acme.caged.read", "version": 1, "scope": "any", "policy": { "policyVersion": 2, "capabilities": ["caged:read"] } }]
  },
  "cage": {
    "module": "participant.wasm",
    "sha256": "<lower-case hex SHA-256 of participant.wasm>",
    "limits": { "fuel": 1000000, "maxMemoryBytes": 16777216, "deadlineMs": 5000 }
  }
}
```

| Key | Meaning |
|---|---|
| `format` | Must be `1` |
| `id` | The participant's identity |
| `manifest` | The same manifest a native participant declares |
| `cage.module` | The `.wasm` file, which must stay inside the package folder |
| `cage.sha256` | Digest of the module. A mismatch refuses the boot with `MODULE_RESOLVE` (digest check failed) |
| `cage.limits` | `fuel` and `maxMemoryBytes` are required; `deadlineMs` is optional |
| `native` | Optional. Used only when the composition declares the entry official |

Behavior you can rely on: a valid package boots and its exposures resolve like any other. A module that is not a working guest fails at call time with `WASM_CAGE_GUEST_FAILED`.

> **Not yet available**
> This beta does not document the guest interface (the exports a `.wasm` must provide, such as `brud_invoke` and linear memory, and how it calls `brud.call`), and it ships no toolchain or template for building a guest. You can load and verify a package today, but you cannot yet author a useful caged participant from these docs. Treat caged authoring as not available in this beta.

## What the cage gives caged code

- **A single entry point.** The only surface is `resolve(participantIdentity, name, options?)`, run on a `runtime` chain as that participant. Caged code reaches exposures this way, like any participant.
- **Plain JSON.** Only plain values cross the boundary.
- **A fuel deadline** per call.
- **A memory limit**, enforced.
- **A 1 MiB response cap.**
- **Fail closed.** Any violation refuses the call.

Caged participants can be givers, interceptors and callers. Code inside WASM takes these roles through the host-to-guest call path (`createCagedParticipant`).

## What the cage does not do

It does not make a participant official, and it does not widen what the giver lets it see. Access is still decided by the giver.

See [Security model](../06-security/security-model.md) and [`docs/kernel-api/reference/services/WasmCage.md`](../../docs/kernel-api/reference/services/WasmCage.md).

**Back to:** [Concepts](README.md)
