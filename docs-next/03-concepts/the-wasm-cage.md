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
| `requires` | Optional. `{ "official": true, "powers": [...] }` makes the kernel refuse the entry unless the owner declares it official. `powers` may list `environment`, `filesystem`, `network` and `process`. It can only refuse a load, never make a package official |

Behavior you can rely on: a valid package boots and its exposures resolve like any other. A module that is not a working guest fails at call time with `WASM_CAGE_GUEST_FAILED`.

## Write a guest

A guest is a WebAssembly module with a small, fixed interface. This beta ships no compiler or template for it: you produce the `.wasm` with your own toolchain (or by hand, as below).

| Export or import | Signature | Role |
|---|---|---|
| `memory` (export) | linear memory | Where requests and responses are exchanged |
| `brud_alloc` (export) | `(len: i32) -> ptr: i32` | Returns where the host may write a request of `len` bytes |
| `brud_invoke` (export) | `(ptr: i32, len: i32) -> i64` | Serves a call to one of the participant's exposures |
| `brud_intercept` (export, optional) | `(ptr: i32, len: i32) -> i64` | Serves an intercepted call; answers a verdict |
| `brud_start` (export, optional) | `(ptr: i32, len: i32) -> i64` | Runs once when the participant starts, with `{ "kind": "start", "token": … }` |
| `brud.call` (import, optional) | `(ptr: i32, len: i32) -> i64` | The guest's only call out |

The host writes a UTF-8 JSON request at the pointer from `brud_alloc`. An export answers with `(ptr << 32) | len`, the location of a UTF-8 JSON response in `memory`.

`brud_invoke` receives `{ "kind": "invoke", "exposure", "method", "args", "caller": { "identity", "callerClass", "official", "capabilities", "origin" } }` and answers `{ "ok": true, "value": … }` or `{ "ok": false, "error": { "code", "message" } }`.

`brud.call` takes `{ "name", "version"?, "method", "args" }` and returns the same `{ ok, value }` or `{ ok, error }` shape. The kernel resolves the name as the caged participant, so the participant gets only what its manifest requested and the giver allows. A `null` resolve comes back as `exposure "<name>" did not resolve`.

A complete guest, in WebAssembly text format, that answers every call by asking `trial.tasks.read` for its stats:

```wat
(module
  (import "brud" "call" (func $call (param i32 i32) (result i64)))
  (memory (export "memory") 1)
  ;; the request {"name":"trial.tasks.read","method":"stats","args":[]}, 54 bytes
  (data (i32.const 1024) "{\"name\":\"trial.tasks.read\",\"method\":\"stats\",\"args\":[]}")
  (func (export "brud_alloc") (param i32) (result i32) (i32.const 4096))
  (func (export "brud_invoke") (param i32 i32) (result i64)
    (call $call (i32.const 1024) (i32.const 54))))
```

Compile it with `wat2wasm` (from `wabt`), set `cage.sha256` to the SHA-256 of the result, and list the package as `"official": false`. The package's `manifest.requests.capabilities` must include `tasks:read` for the call out to succeed.

What the kernel enforces, tested with hostile guests:

| Guest behavior | Outcome |
|---|---|
| Infinite loop | Stopped when its fuel runs out (`WASM_CAGE_GUEST_FAILED`) |
| Trap | `WASM_CAGE_GUEST_FAILED` |
| Memory past `maxMemoryBytes` | Refused (`WASM_CAGE_GUEST_FAILED`) |
| Response over 1 MiB | Refused, "exceeds the size limit" |
| Response that is not JSON | Refused, "malformed JSON" |

Calls into one guest instance run one at a time. Up to 64 more may wait in line, and a call made from inside the same instance's own call is refused. In every case the kernel stays running.

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
