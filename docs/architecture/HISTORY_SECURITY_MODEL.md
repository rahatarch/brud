# History Security Model

**Status:** Decided (2026-11-05) — plan §Appendix G, D-21
**Applies to:** every plugin that calls `context.getHistory()`, the UniversalHistory ledger, and the History UI.
**Scope of enforcement:** Kernel runtime (Layer 1 of the three-layer model).

---

## 1. Purpose and Scope

This document defines how plugins are allowed to interact with the UniversalHistory ledger — the SQLite ledger under `.brud/history/universal.db` that records every workspace mutation, its content-addressed pre- and post-state, and the session that produced it.

It covers:

- What a plugin may ask the ledger to do.
- What a plugin may read, and in what form.
- How namespace isolation is enforced by the Kernel.
- Why raw byte access is denied to plugins.
- The forward-looking viewer contract for the marketplace.

It does not cover the destruction of file data. A plugin with `fs:write` can already mutate or destroy files directly; that risk is handled by capability gating and by marketplace release verification (Layer 2), not by this document. The ledger's job is to preserve an accurate, reversible record — and to prevent that record from being exfiltrated.

## 2. The Threat Model

The threat is **exfiltration**, not destruction.

The ledger contains the user's code history: every file path touched, the full content of pre- and post-mutation states, and — because deleted secrets are still in the pre-images — credentials that the user deleted but that the ledger retained for reversibility. A malicious plugin that can read the ledger in bulk can reconstruct the user's source tree, including deleted secrets, without ever calling a filesystem API.

Once a plugin can destroy data, the ledger cannot save the user. A plugin holding `fs:write` can delete a file directly, without touching the history service. The ledger is therefore not a confidentiality boundary for the files themselves; it is a confidentiality boundary for the *record* of the files. Confusing the two leads to the wrong control: hardening the history API against destruction while leaving raw reads open protects the wrong asset.

Consequences that follow from this threat model:

- Denying raw byte reads is the primary control.
- Losing raw access does not reduce a plugin's ability to do its job, because the abstracted APIs are sufficient for reversible file mutation and typed state persistence.
- The Kernel, not the plugin, decides which namespace a read addresses.

## 3. The Four Access Layers

| Layer | Who | What they get | How |
|---|---|---|---|
| **1. Abstracted APIs** | All plugins | Session management, typed state persistence, modification checks, session summaries, reversal planning | `context.getHistory()` (capability-gated) |
| **2. Raw byte access — own namespace** | Official plugins only | Raw payloads for the caller's own namespace, used for structured state such as UserPrompts | Privileged internal API, namespace-bound at construction |
| **3. Raw byte access — full ledger** | Client only | The complete ledger, including `brud.core.file` | Privileged internal API exposed to the History UI, never to a plugin |
| **4. Never available to any plugin** | — | `brud.core.file`, cross-plugin namespace reads, full ledger dumps | Rejected at the Kernel boundary |

Layers 2 and 3 are deliberately not part of `context.getHistory()`. They exist so that official plugins with structured state and the History UI can do their jobs without widening the plugin contract.

## 4. The Abstracted API Surface

Every plugin interacts with the ledger through these methods on `context.getHistory()`:

- `beginSession({ targets })` — open a session and declare the paths the plugin intends to touch. The declaration is a routing hint, not an authorization grant.
- `commitSession(id, outcome)` — close a session with a terminal outcome.
- `planReversal(id)` — compute a reversal plan for a session without executing it.
- `executeReversal(id)` — execute a previously computed plan.
- `hasModified(path)` — ask whether the ledger has a recorded mutation for a path.
- `getSessionSummary(id)` — retrieve a structured summary of a session.
- `saveMyState(key, value)` — persist typed state in the caller's namespace.
- `loadMyState<T>(key, schema)` — retrieve typed state and validate it against a caller-supplied schema.
- `hasMyState(key)` — check whether a typed-state key exists in the caller's namespace.
- `deleteMyState(key)` — remove a typed-state key from the caller's namespace.

No method on this surface returns raw bytes, raw SQLite rows, CAS object streams, or unvalidated JSON strings. Every value that crosses the boundary is either a structured object the Kernel constructed or a value that has already been deserialized and validated against the caller's schema.

## 5. Namespace Isolation

Every plugin is bound to exactly one namespace, derived from its plugin identity at context construction. The Kernel enforces isolation at three points:

- **Session addressing.** A session created by a plugin can only record and reverse mutations in that plugin's namespace. A session identifier belonging to another namespace is rejected before it reaches the store.
- **`brud.core.file` is unreachable.** The user's file mutation timeline is owned by the Kernel. No plugin method accepts a namespace argument, so there is no parameter a plugin could supply to address it.
- **Cross-plugin reads are rejected at the boundary.** There is no API that takes a foreign namespace name. Namespace is captured in the handle, not passed per call. A plugin cannot request another plugin's state even if it knows the exact key.

Rejection is a hard error, not an empty result. A plugin that attempts a foreign address learns that the address is invalid; it does not learn whether the namespace exists.

## 6. The Typed State Round-Trip

`saveMyState` and `loadMyState` are the supported way for a plugin to persist structured state.

1. The plugin calls `saveMyState(key, value)` with a serializable value.
2. The Kernel serializes the value and stores it in the ledger under the plugin's namespace and key.
3. On read, the Kernel fetches the stored payload, deserializes it, and validates it against the schema passed to `loadMyState<T>(key, schema)`.
4. Only after validation does the Kernel return a typed object `T` to the plugin.

The plugin never sees the serialized form. If the stored value fails validation — for example, because it was written by an older schema version or was tampered with — the Kernel rejects the read instead of handing the plugin an unvalidated string. Schema validation is the Kernel's responsibility, not the plugin's.

## 7. Reversal Safety

The ReversalEngine refuses to revert anything that is not recorded in the session.

- **Declared targets are routing hints, not authority.** The `targets` passed to `beginSession({ targets })` tell the Kernel where the plugin intends to operate. They do not authorize a reversal and they do not define its scope.
- **Pre-states come from recorded mutations.** A reversal restores the pre-state that the ledger recorded at mutation time. It never reconstructs a pre-state from a plugin's declaration, and it never accepts a plugin-supplied pre-state.
- **Unrecorded paths are refused.** If a path has no recorded mutation in the session, `planReversal` will not include it and `executeReversal` will not touch it. A plugin cannot use the reversal engine as a general-purpose write path.

## 8. Forward-Looking: Viewer Contract (Post-Rollout)

> **Not implemented in the current rollout.** This section records a design decision for the marketplace era. No code described here exists today.

When a marketplace exposes History viewers, a viewer plugin will format a history entry for display. The naive design — hand the viewer the raw payload — reintroduces the exfiltration threat that D-21 closes. The viewer contract therefore keeps raw bytes inside the Kernel:

- **Compile-time contract.** A viewer is a pure render function. It receives a Kernel-constructed `ContentPayload` and returns presentation output. It cannot import capability handles, cannot call `fetch`, and cannot write to globals. The contract is enforced at build time, so a viewer that violates it does not publish.
- **Runtime sandboxing.** `render()` executes in a sandbox with the payload passed as an argument. The viewer never holds a reference it could persist, proxy, or exfiltrate.
- **Build-time verification.** The marketplace code checker and static analysis reject viewers that reach outside the contract before they are accepted.
- **Post-release telemetry.** Anomalous behavior is monitored after publication, with revocation available as the response.

The viewer formats a Kernel-constructed payload; it never possesses the raw bytes. This extends the D-21 boundary from the runtime API into the release pipeline.

## 9. The Three-Layer Security Model

| Layer | Where | Controls | This document |
|---|---|---|---|
| **Layer 1 — Kernel runtime** | `packages/kernel` | Namespace isolation, capability gating, schema validation | The history model is this layer. |
| **Layer 2 — Release verification** | Marketplace pipeline | Code checker, static analysis, human review | The viewer contract extends the model into this layer. |
| **Layer 3 — Post-release** | Operations | Telemetry, revocation, audit | Backstops both layers. |

The history security model is a Layer 1 control. It is written so that it composes with Layer 2 and Layer 3 rather than duplicating them: the Kernel enforces what can be called, the marketplace enforces what can be published, and operations enforces what can keep running.

## 10. References

- **D-18** — production-realistic, zero-mock, adversarial testing.
- **D-19** — Level-1 Utility Service (`brud.core.utils`).
- **D-20** — Utility vs. Plugin boundary, including the Zero Dependency mandate.
- **D-21** — this decision (`docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md` §Appendix G).
- **Phase 9 discovery audit** — `.internal_docs/audits/2026-11-05_phase_9_filesystem_discovery.md`.