# The WASM cage

The cage is the hardcore that runs untrusted code in isolation.

## Status in this beta

Be clear about what ships. A module not declared official is refused as native code. The cage primitive exists and is verified, but it is a building block, not a finished plugin system. This page describes only what is verified.

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
