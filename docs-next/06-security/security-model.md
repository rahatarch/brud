# Security model

What BrudOS protects, how, and where the limits are.

## The core idea

**The giver decides.** Every API is offered by a participant that chooses who may use it. Nothing is open by default, and a refusal reveals nothing about why.

## What enforces it

| Mechanism | What it guarantees |
|---|---|
| Kernel-issued identity | A participant cannot claim to be another. Identity says who, never what is allowed |
| Call chain with real origin | Scope and policy are checked against where the chain began, not what a caller says |
| Re-authorization on every call | A handle is checked again each time it is used, and dies with its chain |
| Fail-closed parsing | Malformed Brud text, policies, manifests and schemas are refused, not guessed at |
| Pinned hardcores | The seven core services are verified against content hashes at boot. Boot fails on a mismatch |
| Owner-declared `official` | Only the composition's owner can mark a participant official. Packages cannot self-promote |
| Frozen config | The composition cannot change while the kernel runs |
| Private denial reasons | Refused callers get `null`. The reason goes only to the host's observation stream |

## The daemon channel

- Communication is over a local socket with a Noise channel keyed by a per-tier secret token. Tokens are written owner-only when the daemon starts.
- On POSIX the socket's ownership and mode are verified. The only peer admitted is the process that launched the daemon.
- The caller tier (`ui` or `ai`) comes from the authenticated session. Requests cannot assert it.
- The operator decides which startup fields clients may set. Fixed options cannot be overridden.
- A token for one tier cannot be used as the other. A wrong or swapped token closes the channel at the handshake.
- A kernel belongs to the connection that booted it. Another connection cannot see, route into or dispose it unless it attaches.
- Plain text on the socket without the handshake gets no answer.
- A connection may have at most 64 requests in flight. Past that, requests are refused with `-32017` (`RESOURCE_EXHAUSTED`). The daemon stays responsive.

## The WASM cage

Caged code gets plain JSON in and out, a fuel budget per call, a memory limit, and a 1 MiB response cap. A trap, an exhausted budget, a malformed response or an oversized response refuses that call and leaves the kernel running. A caged participant can call only the exposures its manifest requested and the giver admits, and never an exposure that requires `official: true`. See [The WASM cage](../03-concepts/the-wasm-cage.md).

## Honest limits

- **Trust is a content hash you chose.** There is no publisher signature or marketplace. If you mark a participant official, it runs with your trust.
- **Native code is trusted code.** An official participant runs in the host process. Isolation for anything else depends on the WASM cage, which in this beta is a verified primitive with no authoring toolchain, not a complete plugin story. Non-official native modules are refused.
- **Interception is cooperative.** A giver that never opens a point cannot be intercepted.
- **Windows** does not expose socket ownership through the file system, so the ownership check is skipped there.
- **Local only.** The daemon is a local-host design, not a network service.

If you find a vulnerability, report it through the repository's security contact rather than a public issue.
