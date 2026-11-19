# The seven hardcore primitives

The hardcores are compiled into the kernel, booted in this order, and each verified against its pinned content hash. Types: [reference](../reference/README.md). Contract interfaces and flags: [hardcores](../catalogue/hardcores.md). Callable surfaces: [mechanism exposures](../catalogue/exposures.md).

## 1. Identity Registry — `brud.core.identityRegistry`
Issues and records each participant's kernel identity at boot (`issue`, `resolve`, `retire`, `revoke`). Identity is who you are, never what you may do. [Reference](../reference/services/IdentityRegistry/contracts.md).

## 2. Exposed API Registry — `brud.core.exposedApiRegistry`
Holds every participant's `manifest.exposures` and answers `resolve(name, { version?, expectedOwner? })` by evaluating the giver's scope and policy against the caller. Every later use of the handle is re-authorized and runs as the giver. A refused resolve is `null`; a refused handle call throws (`EXPOSED_API_UNAVAILABLE`). [Reference](../reference/services/ExposedApiRegistry/contracts.md).

## 3. Parser — `brud.core.parser`
Turns raw input into normalized operation records (`BrudOperation { index, kind, name, parameters }`, all read-only). [Reference](../reference/services/Parser/contracts.md).

## 4. Router — `brud.core.router`
Services register the operation kinds they handle (`register`, one service per kind, then `closeRegistration`); `route(rawInput)` parses and `dispatch(operations)` sends each operation to its registered service and returns a `BrudRouteResult` with one outcome per operation. [Reference](../reference/services/Router/contracts.md).

## 5. WASM Cage — `brud.core.wasmCage` (mechanism)
The only surface is `resolve(participantIdentity, name, options?)`, run on a `runtime` chain as that participant. A caged participant reaches every exposure, including the hardcores' mechanism exposures, this way. Plain JSON values only. The host-to-guest call path (`createCagedParticipant`) gives caged code the giver and interceptor roles: plain values, per-call fuel deadline, enforced memory limit, 1 MiB response cap, fail closed. [Reference](../reference/services/WasmCage.md).

## 6. Events — `brud.core.events` (mechanism)
Pull-based, observable events. [Reference](../reference/services/Events/contracts.md).

**Declare** (the emitter, the event's giver): `manifest.events: [{ name, version?, scope?, policy?, payloadSchema? }]`. `payloadSchema` is a JSON Schema subset (`type`, `properties`, `required`, `additionalProperties`, `enum`, `const`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern`, `oneOf`); unsupported keywords fail closed. A name belongs to its first declarer (`EVENTS_NAME_COLLISION`).

**Use** (all via `registry.resolve`, scope `runtime`):

| Call | Result |
|---|---|
| `events.subscribe(name, { policy?, lastSequence?, subscriber? })` | subscription id `name@major#n`, or `null` (unknown event, or scope/policy refuse the subscriber). Policy and scope are decided **here**, once. |
| `events.emit(name, payload)` | `{ ok: true, sequence, refusedSubscriptions }` or `{ ok: false, reason: 'malformed' \| 'refused', detail }`. Only the event's owner may emit; the payload is validated; a refused emit consumes no sequence. |
| `events.pull(id, { lastSequence?, maxBatch? })` | a batch of `{ eventName, eventVersion, emitterIdentity, emitOrigin, sequence, payload }`, or `{ refused: true, reason: 'unknown-subscription' \| 'not-subscriber' \| 'closed' }`. `lastSequence` reconnects from the retention log. |
| `events.close(id)` | `undefined`, or a refusal; only the subscriber may close. The subscription is tombstoned. |
| `events.list()` | declared events as `name@major` |

**Delivery**: each event has a per-event sequence (the same number for every subscriber) and a bounded retention log (default 100); each subscription is a cursor with a queue bound (default 50) and a batch bound (default 10). Backpressure is the subscriber's choice at subscribe: `drop-oldest` (default), `drop-newest`, or `refuse-emit` (that subscriber's copy is refused; others still receive).

**Subscribing for someone else**: an event's owner may pass `{ subscriber: callerView }` — the caller view its own projection received — so the subscription belongs to the end subscriber (delegation by the owner).

## 7. Interception — `brud.core.interception` (mechanism)
Synchronous, giver-admitted interception of calls to a giver's exposure. [Reference](../reference/services/Interception/contracts.md).

**Declare**:
- The interceptor: `manifest.interceptions: [{ target, version? }]`, and a non-enumerable `intercept(call)` method on its instance returning `{ verdict: 'allow' }`, `{ verdict: 'block', reason }`, or `{ verdict: 'modify', args }`.
- The giver: `manifest.interceptionPoints: [{ exposure, version?, admit: [serviceToken, …] }]` on one of its own exposures; `admit` is also the run order.

Boot is refused (`INTERCEPTION_DECLARATION_INVALID`) for an interception no giver admits, an admitted participant that does not declare the interception, a point on an exposure the declarer does not give, or an interception of a hardcore's exposure. Interceptors are never registered with the registry and cannot be resolved.

**Opt in** (the giver's binding):
```ts
'acme.greet@1': { projection: (_service, caller) => ({
  greet: (...args: unknown[]) => {
    const outcome = evaluate.evaluate('acme.greet@1', 'greet', args, { caller });
    if (!outcome.allowed) throw new InterceptionBlockedError('acme.greet@1', outcome.reason, outcome.interceptor);
    return instance.greet(...(outcome.args as [string]));
  },
}) },
```
where `evaluate = registry.resolve('interception.evaluate')` (scope `any`; only the point's owner may evaluate it).

**Semantics**: interceptors run in the giver's order, each as itself, seeing a frozen `InterceptedCall { target, method, args, caller }` with the real caller's identity and origin. The first `block` wins; `modify` replaces arguments only (re-validated as plain JSON) and chains; a throw or an invalid verdict blocks (fail closed). The outcome is `{ allowed: true, args, modifiedBy }` or `{ allowed: false, reason, interceptor? }`.

**Limits**: interception is cooperative (a giver that opens no point cannot be intercepted). Caged participants have the same roles as native ones — intercepted caller, giver opening a point, and interceptor; code executing inside WASM takes these roles through the cage's host-to-guest call path (`createCagedParticipant`; see [Concepts](concepts.md#caged-participants)).
