# Identity and the call chain

The kernel decides who is calling, so a participant never has to trust a caller's claim. This page explains kernel identity, the call chain, and delegation by the owner.

## Kernel identity

When a participant is admitted at boot, the kernel issues it a **kernel identity**: an opaque token recorded in the Identity Registry. Identity answers one question: *who is this?* It never answers *what may they do?* That is the giver's job.

Identities are issued by the kernel and cannot be chosen, copied or forged by a participant. The registry can retire or revoke them.

## The call chain

Every call the kernel mediates runs inside a **call chain**. The chain carries:

| Field | Meaning |
|---|---|
| `caller.identity` | The caller's kernel identity. `null` for the kernel itself and for a host session |
| `caller.callerClass` | `participant`, `kernel`, or `host` |
| `caller.official` | Whether the composition owner declared this caller official |
| `caller.capabilities` | The capabilities the caller requested |
| `caller.parentIdentity` | For a caged child, the identity of the participant that loaded it |
| `origin` | Where the chain began: `kernel`, `runtime`, or `host` |

These are fixed when the participant is admitted (or, for a host, when the host call starts). A participant cannot change them mid-flight.

## Origins

| Origin | A chain that starts... |
|---|---|
| `kernel` | inside the kernel, for example during its own boot work |
| `runtime` | in participant code: lifecycle hooks and calls made by participants |
| `host` | from outside, through `kernel.runHostCall` |

## The giver runs as itself

When a caller uses a giver's handle, **the giver's code runs as the giver.** If the giver calls a third participant, the kernel sees the giver as the caller. It does not see the original caller.

To learn who really asked, use the `caller` argument. The kernel hands it the real caller's view **once, when the handle is created**: the `caller` argument of your `handle` function (or projection factory). Capture what you need there. This is called **delegation by the owner**: you, the owner, decide how to use the real caller's identity when you act on their behalf.

```js
handle: (caller, ctx) => ({
  // `caller` is the REAL caller. Inside this method, the kernel sees the giver as the caller.
  whoAsked: () => caller.identity,
}),
```

## Every use is re-checked

Resolving an exposure is not the end of the checks. **Each call through the handle is authorized again** against the chain that makes it. That is why a handle used outside a host call is refused: there is no valid chain around it.

## Why it is built this way

Because the real caller is assigned by the kernel and carried with the call, a service never has to ask "are you really who you say you are?" and a client can never claim to be someone it is not. Audit trails and permission checks rest on that.

**Next:** [Exposures, scope and policy](exposures-scope-and-policy.md)
