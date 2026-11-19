# Concepts

## Participants, givers, and the kernel
Every service, plugin, or app is a **participant**. A participant **declares** what it wants (its manifest); the declaration is a request, not a grant. The participant that offers an API — the **giver** — decides who may use it; the kernel routes every call to the giver and enforces the giver's answer. Identity is not authority.

## Identity and the call chain
Each admitted participant receives a **kernel-issued identity** at boot. Every call runs inside a **call chain** that carries:

| Field | Meaning |
|---|---|
| `caller.identity` | the caller's kernel identity (`null` if unidentified) |
| `caller.callerClass` | `participant`, `kernel`, … |
| `caller.official` | the composition's official status for the caller (mechanism hardcores are non-official) |
| `caller.capabilities` | capabilities the caller's manifest requested |
| `origin` | where the chain started: `kernel`, `runtime` (participant lifecycle and caged calls), or `host` |

These are **fixed at admission**: identity, class, capabilities, official status, and origin do not change during a boot. A different outcome needs a reload (a new admission) or a reboot.

## Exposures: resolve, then call
A giver declares callable APIs in `manifest.exposures` (`name`, `version`, `scope`, `policy`). A caller gets one with `registry.resolve(name)`, which returns the giver's **projection** (or `null` if refused). Two rules matter:

1. **Every use of a resolved handle is re-authorized** against the chain making that call — not only at resolve time.
2. **The giver's code runs as the giver.** Inside a projection method, the current caller is the giver. The *real* caller is the caller view the registry passes to the projection factory at resolve time: `projection(service, caller)`. Hardcores and givers that need the real caller capture it there — **delegation by the owner**.

## Scope and policy
**Scope** gates origins: `kernel` admits kernel only; `runtime` admits kernel and runtime; `host` admits host only; `any` admits all. **Policy** (`policyVersion: 2`) narrows further: `origins`, `callerClasses`, `parentCallerClasses`, `capabilities`, `official`. A refused resolve is a uniform `null`.

## Declarations that are not callables
The registry carries **callables only**. A primitive whose participant-facing concept is not a callable gets its own manifest surface and its own hardcore catalogue, and reaches participant code only through that hardcore: events (`manifest.events`) and interception (`manifest.interceptions`, `manifest.interceptionPoints`). See [the manifest keys](../catalogue/manifest.md).

## Caged participants
The WASM cage's only outward surface is `resolve`. A caged participant reaches any exposure — including the hardcores' mechanism exposures — through `cage.resolve(participantIdentity, name)`, which runs on a `runtime` chain as that participant. Only plain JSON values cross the boundary.

**Caged participants have the same roles as native ones** — caller, giver, interceptor, subscriber, emitter — unless a role is a security concern; the kernel makes no distinction. Code that executes inside WASM gets these roles through the cage's host-to-guest call path (the call *in*): `createCagedParticipant({ token, manifest, wasm, limits? })` builds an ordinary participant descriptor whose exposures, interception points, and `intercept` are served by the guest. The call in is host-driven, carries plain JSON values only, runs under a fresh fuel budget per call (its deadline) inside an enforced memory limit, caps responses at 1 MiB, and fails closed on a trap, an exhausted budget, a malformed response, or an invalid verdict. `resolve` stays the caged participant's only call *out*.

**Guest ABI.** The guest exports `memory`, `brud_alloc(len) -> ptr`, `brud_invoke(ptr, len) -> i64`, and (for an interceptor) `brud_intercept(ptr, len) -> i64`. The host writes a UTF-8 JSON request at the pointer from `brud_alloc`; the export returns `(ptr << 32) | len` of a UTF-8 JSON response. `brud_invoke` receives `{ kind: 'invoke', exposure, method, args, caller: { identity, callerClass, official, capabilities, origin } }` and answers `{ ok: true, value }` or `{ ok: false, error: { code, message } }` (a failure throws `WASM_CAGE_GUEST_FAILED`). `brud_intercept` receives the intercepted call and answers a verdict (`allow`, `block` with `reason`, `modify` with `args`). A caged giver with an interception point runs `interception.evaluate` before the guest sees the call.

**Calling out.** A guest may import `brud.call(ptr, len) -> i64`, its only call out: the request is `{ name, version?, method, args }`, resolved through the exposed-API registry as the caged participant (exactly as a native participant resolves), answered with `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. A guest may also export `brud_start(ptr, len) -> i64`, called once when the participant starts running with `{ kind: 'start', token }`, so it can act as caller, subscriber and emitter without being called first. Routed calls happen only while the host is calling the guest; a routed call back into the same busy instance is refused. **Async APIs work:** when a routed call returns a Promise, the guest is suspended (on a Wasmtime fiber) while the host awaits inside the caller's call chain, then resumed with the result — guest code stays synchronous. A caged exposure method is synchronous when nothing it called was async, and returns a Promise when something was awaited, like native code. Results must be plain JSON (checked deeply; otherwise `WASM_CAGE_ROUTED_NOT_PLAIN`). Each call into the guest has a wall-clock deadline (`limits.deadlineMs`, default 30 s); past it, routed calls are answered with `WASM_CAGE_ROUTED_TIMEOUT`. A routed call may set `"abortable": true`: its last argument must be a plain options object, and the host adds the call's `AbortSignal` as `signal`, aborted at the deadline. Calls into a busy instance wait their turn (FIFO, up to 64 queued; the deadline counts from queueing); a guest calling back into its own instance is refused, and a busy instance fails interceptors closed. Interceptors stay synchronous: an interceptor's awaited routed call is answered with `WASM_CAGE_ROUTED_ASYNC`, which fails the interception closed.

**Platforms.** The cage ships one native binary per platform (`brud-wasm-cage.<platform>.node`: `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-x64`, `darwin-arm64`, `win32-x64-msvc`). Their SHA-256 digests are in a table inside the cage's pinned package, and the loader refuses a binary whose digest is not listed (`WASM_CAGE_NATIVE_TAMPERED`). On a platform with no binary the kernel still boots; only caged participants are unavailable (`WASM_CAGE_NATIVE_UNAVAILABLE`).

## Observations
Refusals and diagnostics are recorded on the **observation stream** (`BrudKernel.readObservations()`). It is for diagnostics, not delivery. See [the observation events](../catalogue/observations.md).
