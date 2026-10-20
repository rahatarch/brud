# Brud Code MCP Subsystem: Architectural Design Specification

## Document Control

- **Classification:** Internal architectural specification
- **Status:** Approved target contract. The shipped behaviour of every subsection is tracked in **§9 Implementation Status Register**; a subsection whose behaviour differs from its text carries an `Implementation status` note at its head. This document is deliberately not rewritten to match the code, so the approved intent and the current reality stay separately readable.
- **Audience:** Platform engineers, security reviewers, packaging maintainers, integration test authors
- **Relation to Baseline:** Extends the Microkernel Architecture Specification (docs/architecture/microkernel-architecture-spec.md) with a defined machine-to-machine transport subsystem. This document introduces no exceptions to the Inversion Invariant; it formalizes how the existing pure orchestrator may be reached by external AI clients.

---

## 1. Subsystem Identity & Strategic Purpose

The Model Context Protocol (MCP) subsystem is the machine-to-machine transport layer of the Brud Code ecosystem. It exposes the orchestration, validation, and execution capabilities of the Brud microkernel over a standardized remote procedure call protocol, enabling external AI hosts to invoke file system operations, terminal commands, and workspace primitives through the same guarded execution pipeline that human users drive through the interactive interface.

MCP serves as a complement, never a replacement, to the existing human-in-the-loop clipboard workflow. The clipboard workflow is a manual, presence-driven path in which a human operator moves Brud instruction blocks into the environment and reviews the consequences before they are applied. The MCP transport is an autonomous, programmatic path in which an external AI model issues structured tool invocations directly to the running engine. Both paths converge on the identical kernel: the same operation handlers, the same validation gatekeeper, and the same snapshot and rollback machinery. Nothing in the MCP layer enjoys a privilege that the interactive path does not.

The primary consumer use cases define the strategic value of the subsystem:

- **Claude Desktop integration.** Desktop clients may register Brud as a connected model-context server and dispatch file manipulation and terminal execution requests from a conversational interface, turning Brud into a guarded execution backend for an otherwise passive assistant.

- **Cursor and IDE-native agents.** Cursor and similar agentic editing surfaces may attach to the active workspace server, allowing their built-in models to list and invoke Brud tools that operate exclusively within the currently opened project.

- **Autonomous agents and headless orchestrators.** Pipeline runners, CI stages, and scripting hosts may launch Brud with a dedicated transport in a command-line or containerized environment, obtaining a fully operational execution server without any graphical interface.

In all three cases the architectural contract is identical: the external client is treated as untrusted, its arguments are normalized and validated, its operations are executed through the kernel, and its results are returned as structured diagnostics.

---

## 2. The Inversion Invariant & Architectural Boundaries

> **Implementation status:** Deviated (D1). The package depends on `@brud/core` as well as the kernel and protocol contracts, by Architect direction. The one-way rule against any dependency on `apps/vscode`, `packages/ui`, or an editor adapter is enforced at build time. See §9.

The Inversion Invariant, as established by the Microkernel Architecture Specification, states that `@brud/core` is a pure, zero-dependency orchestrator that never imports Node.js file system primitives, process management primitives, or editor host APIs. The MCP subsystem extends this invariant with a strictly symmetric boundary: the core MCP engine is an autonomous, platform-agnostic package named `packages/mcp`, and it is not a subsystem embedded inside `apps/vscode`.

This separation of concerns guarantees the following architectural properties:

- **The protocol engine is host-independent.** The package implements protocol lifecycle management, transport listeners, tool catalog synthesis, and execution translation against the kernel contracts alone. It owns no editor knowledge, renders no user interface, and holds no assumption about the process that spawned it.

- **The VS Code extension is a lightweight host sensor and remote control.** `apps/vscode` does not implement protocol framing or transport plumbing. It performs exactly two duties. First, as a host sensor, it observes the open workspace, the active folder, and the editor lifecycle, and it communicates the active workspace path to a running server. Second, as a visual management remote control, it renders the server status and exposes start, stop, reset, auto-on, and configuration-export controls inside the Management Panel. Both duties are data-facing, not protocol-facing.

- **Headless execution is a first-class capability.** Because the engine does not depend on the editor host, the same server binary can be launched by a command-line runner, a background system daemon, or a containerized runtime. In each environment the engine binds its configured transport, ingests the workspace anchor, and serves tool invocations. No graphical IDE is required to install, configure, or operate the server.

The dependency direction is rigid and one-way. The MCP package depends on the kernel and on the protocol contracts; `apps/vscode` depends on the MCP package for lifecycle control and status reporting. The MCP package never depends on `apps/vscode`, on the UI package, or on any editor adapter. A build-time enforcement rule, matching the posture of the custom Brud Packager, treats any import from the MCP package toward an application or editor layer as a fatal packaging error.

---

## 3. Subsystem Architecture & Responsibility Matrix

### 3.1 The Standalone Protocol Engine

> **Implementation status:** Partially enforced (D2, D3). The catalog is synthesized on demand, but from the shared tool registry rather than a kernel `promptDescriptor`; lifecycle states are tracked by the host service, not by a state machine inside the engine. See §9.

The standalone protocol engine is the singleton runtime core of the subsystem. It owns the complete life of a server instance across four responsibilities.

**Protocol lifecycle management.** The engine tracks the server state machine through distinct phases: initializing, listening, serving, draining, and stopped. Each phase transition is broadcast to attached observers so that host sensors and management panels can render accurate status without polling the transport.

**Dynamic tool catalog synthesis.** The engine does not maintain a static list of tools. Instead, on every tool-listing request, it reads the current operation registry of the kernel, extracts the documented prompt descriptors and capability metadata for every registered operation, and synthesizes a fresh catalog. The catalog therefore reflects additions, removals, and contract changes in the kernel without a server restart.

**Execution translation.** The engine receives structured tool invocations, normalizes their arguments, and dispatches them into the kernel execution pipeline with the currently anchored workspace path. It translates the kernel result envelope into the protocol result envelope and returns it to the calling client.

**Transport listeners.** The engine binds and owns one or both transport listeners described in the Transport Layer Specifications. It supervises their acceptance loops, their error channels, and their graceful shutdown so that a transport failure never corrupts the kernel or leaks a half-open execution.

### 3.2 The Active Workspace Anchor

> **Implementation status:** Deviated (D4). The workspace is supplied and canonicalized at start-up; there is no anchor channel, and switching projects restarts the server through the host. See §9.

The server is deliberately stateless with respect to workspace identity at startup: it does not assume the current working directory at launch time is the intended project boundary. Instead, it ingests the active workspace filesystem path dynamically through a workspace anchor channel.

The anchor is set through two equivalent routes. In an editor-hosted session, the VS Code extension observes the current workspace folder and pushes it to the server whenever the user opens a project or switches to another folder. In a headless session, the launcher supplies the workspace path through a startup configuration. In both routes the anchor takes effect only when explicitly delivered; a server that has received no anchor refuses to serve operations.

Upon delivery, the anchor is canonicalized: symbolic links are resolved, case folding is applied per platform rules, and the result is retained as the single enforcement root for the life of the server, or until a later anchor replaces it. Every subsequent request is validated against this root. A workspace switch therefore changes the perimeter of enforcement atomically; no operation begun under the previous anchor is allowed to complete outside the new boundary, and no new operation is admitted with the stale boundary.

### 3.3 The Inescapable Gatekeeper Shield

> **Implementation status:** Deviated (D5). Every call passes the shared kernel validation layer and the checks run in the stated order, but path containment and command safety are gated by project settings and can be switched off. The MCP layer adds no gate of its own. See §9.

Every incoming tool invocation, from every transport, passes through the Gatekeeper before the kernel sees it. The Gatekeeper is not an MCP-specific reimplementation of security logic; it is the same microkernel validation layer used by all internal callers. The MCP engine contributes only the discipline of routing: there is no bypass path, no administrative alias, and no trusted-client shortcut.

Concretely, the shield performs the following checks in strict order before any execution is admitted:

- The anchoring check, which refuses service when no active workspace has been delivered.
- The path containment check, which resolves every supplied path against the anchored workspace root and rejects any path that escapes the boundary, whether by absolute reference, traversal segments, or symlink redirection.
- The command safety check, which passes any command-shaped argument through the dangerous-command detector of the validation layer.
- The capability check, which confirms that the operation's declared capabilities are satisfiable by the current service container.

The practical effect is that external AI callers are physically barred from reading or mutating files outside the project boundary. An attempt to address a sibling project, a home directory, or an arbitrary system path is rejected with a structured diagnostic, not merely a warning. Because the shield is the shared validation layer, any future security patch applied to the validation API protects the MCP transport instantly and without a transport-layer code change.

### 3.4 The Reversibility Layer

> **Implementation status:** Partially enforced (D6). Snapshots and single-action undo hold for machine-invoked writes; the link back to the originating invocation does not exist, so history cannot distinguish AI-originated changes. See §9.

The subsystem guarantees that actions executed by external AI models remain reversible under the same contract as interactive sessions. Before the kernel executes an admitted operation, the reversibility layer engages the history engine of the core to capture a pre-execution snapshot of every file the operation is about to affect. After execution completes, a post-execution diff snapshot is recorded. The two snapshots are linked to the originating invocation so that each machine-driven action is addressable as a discrete, reversible unit.

This yields a single-action undo guarantee for the human user. Regardless of whether an edit was authored by a human prompt or by an AI model over the MCP transport, the user may roll the affected files back to their pre-invocation state with one action in the History interface. The transport adds no exception to the snapshot policy: a machine-invoked write is as reversible as an interactive one, and no operation can be excluded from snapshot capture.

---

## 4. Transport Layer Specifications

The subsystem ships with a dual-transport architecture, each transport selected for a distinct environment and each sharing the same engine core, the same gatekeeper, and the same result translation.

### 4.1 Server-Sent Events and HTTP Transport

> **Implementation status:** Deviated (D7) and enforced (D8). The HTTP transport is stateless with JSON responses: no SSE stream, no provisional handles, no lifecycle events, no keep-alive. Deadline expiry and client-disconnect cancellation are enforced end to end from 2026-10-20 onward. See §9.

The streaming transport is designed for long-running editor integration and for clients that benefit from incremental result delivery. It couples an HTTP endpoint for client-to-server requests with a Server-Sent Events stream for server-to-client notifications and responses.

Request lifecycle follows a straightforward pattern. A client posts a structured request to the request endpoint. The server acknowledges it immediately with a provisional handle, queues it into the execution path, and later emits the completed outcome on the notification stream keyed to that handle. This decoupling allows the server to accept new requests while earlier invocations are still executing, and it allows the client to observe progress segments and terminal results in real time.

The streaming transport additionally carries server-sent lifecycle events, including workspace anchor changes, server state transitions, and catalog invalidation notices. These events permit an IDE to refresh its tool palette only when the catalog actually changes, rather than polling.

Connection management policy is explicit. The server applies an idle keep-alive to maintain stream liveness through silent periods. Requests are bounded with a configurable execution timeout, after which the invocation is terminated and a timeout diagnostic is emitted. A client that closes its stream or aborts its connection has its in-flight invocation cancelled at the kernel level through the standard cancellation signal, preserving snapshot integrity during the abort.

### 4.2 Stdio Transport

> **Implementation status:** Partially enforced (D9). Framing, byte-clean diagnostics and the deadline are enforced; end-of-stream draining is left to the transport library. See §9.

The standard input/output transport targets direct process-pipe communication, which is the canonical wiring used by Claude Desktop and by command-line agent launchers. In this transport, the server is spawned as a child process by the external client, reads framed requests from its standard input stream, and writes framed responses to its standard output stream. Diagnostic and logging output are redirected exclusively to the standard error stream so that the protocol channel remains byte-clean.

Stdio provides a degenerate but reliable lifecycle: the transport runs exactly as long as the owning process keeps the pipe open. When standard input reaches end-of-stream, the server treats it as a termination request and enters the draining phase, allowing in-flight operations to reach a safe checkpoint before the process exits. This makes the transport ideal for short-lived agent bursts in which the client owns the lifetime.

### 4.3 Loopback Binding, Port Allocation, and Socket Lifecycle

> **Implementation status:** Mostly enforced (D10). Loopback-only binding, fail-closed fixed ports, ephemeral allocation and unconditional release are enforced; the peer-server identity probe at launch is not implemented. See §9.

The HTTP-facing transport binds exclusively to the loopback interface by default. This policy ensures the server is reachable only from the local machine and is never published on a routable network interface without an explicit, deliberate override by a system administrator.

Port allocation follows a collision-averse policy. When the server is configured with a specific port, it attempts to bind that port and fails closed with a structured launch error if the port is already occupied. When the server is configured for automatic allocation, it requests an ephemeral port from the operating system, records the assigned port, and publishes it to the host sensor so the management panel can display the live endpoint. On every launch the server verifies that the candidate port is not already bound by a peer Brud server, preventing accidental dual-server ambiguity within a single workspace.

The socket lifecycle mirrors the server state machine. In the listening phase the acceptor loop is live and errors on the socket are surfaced to the server supervisor. In the draining phase the server stops accepting new connections, allows in-flight requests to complete under the execution timeout, and then releases the socket. Releases are unconditional: on stop, on crash recovery, and on host shutdown, the port is returned to the operating system, and a subsequent launch of the server acquires a fresh binding. No stale socket file or orphaned listener may survive a terminated server.

---

## 5. User Experience & Management Panel Integration

> **Implementation status:** Partially enforced (D11, D12). Status, Start/Stop, and Auto-On are enforced; Auto-On is stored in `.brud/settings.json` rather than editor workspace configuration, and the exported configuration is a single URL block with no consumer selection or authorization preamble. See §9.

The VS Code Management Panel hosts a dedicated MCP Server section that presents the subsystem as a first-class, observable service rather than a hidden background process. The section provides four capabilities.

**Real-time status monitoring.** The section renders the live state of the server, including the current phase (Active or Stopped), the bound port or the auto-assigned port when listening, and the currently anchored workspace root. Status is driven by server-pushed lifecycle events, so the display updates the instant the state changes rather than on a refresh cycle.

**One-click manual controls.** The section exposes explicit Start and Stop actions. Starting the server instantiates the engine, binds the configured transport, and, when running inside the editor, immediately pushes the currently active workspace as the anchor. Stopping the server drains in-flight work and releases the transport cleanly. The controls are disabled when their corresponding action is not available, preventing conflicting double-commands from the user interface.

**Auto-On configuration.** A persistent setting, labeled Auto-On, decides whether the server boots automatically when a project is opened. When enabled, extension activation after workspace open launches the server in the background without user interaction and anchors it to the opened folder. When disabled, the server remains dormant until the user presses Start. The setting is stored in workspace configuration, so it travels with the project and can be managed per environment through normal configuration distribution.

**Single-action configuration export.** The section includes an export utility that generates a ready-to-use client configuration block for external consumers. Activating the export copies the correct endpoint, transport descriptor, and tool authorization preamble for the selected consumer (for example, a desktop client or an IDE agent configuration) directly to the clipboard. The utility derives the values from the live server state, so the exported block always reflects the actual bound port and the actual workspace anchor rather than stale defaults. This removes the most common on-ramp failure: misconfigured client-to-server handshakes.

The Management Panel is purely a remote control. It renders state and issues lifecycle commands; it never frames protocol traffic, never interposes on request payloads, and never touches the execution path.

---

## 6. Schema Conversion & Parameter Normalization Logic

### 6.1 Catalog Synthesis and Tool Enumeration

> **Implementation status:** Deviated (D2) and enforced with a caveat (D13). Enumeration comes from the shared tool registry; twenty documented operations become twenty tools, and `get_tool_info` is intentionally not exposed to clients. The tool list is generated, but the parameter map is a second hand-maintained table guarded by tests. See §9.

The translation between Brud's internal tool documentation and the standard object schemas expected by protocol clients is a pure, deterministic conversion function. Each registered operation in the kernel carries a prompt descriptor which declares the operation's purpose, its input fields, the type and arithmetic constraints of each field, and the shape of its result. The converter walks that descriptor and emits a standard tool schema for each operation, mapping descriptive metadata to summary and detail fields, input fields to typed parameters, and result declarations to output schemas.

The conversion is enforced to be lossless in one direction: every operation that is registered and documented in the kernel results in exactly one enumerable tool. Conversely, operations that failed to bind a validator or failed to supply documentation are excluded, mirroring the pruning posture of the microkernel specification. The synthesized catalog is recomputed on demand, as described under dynamic tool catalog synthesis, so enumeration errors self-heal the moment a registration is corrected.

No hand-maintained mirror of the tool list exists anywhere in the subsystem. A single source of tool truth, the operation registry, feeds both the interactive prompt surface and the protocol catalog. Any operation added once becomes visible to every consumer automatically and identically.

### 6.2 Parameter Normalization Bridge

External clients do not speak Brud's internal operation contract; they speak the protocol's generic parameter vocabulary. The parameter normalization bridge is the adapter that converts between the two without ever weakening validation.

The bridge performs three duties in order. First, it maps each received argument from its protocol parameter name to the corresponding internal property name declared by the operation descriptor. Second, it coerces values to the declared property types, applying explicit conversion rules only where the operation descriptor declares them safe, and rejecting values that cannot be coerced rather than silently coercing. Third, it passes the normalized property set into the kernel execution request, at which point the operation's schema-level validation and the gatekeeper's path-level validation both run against the normalized values.

The bridge is strictly input-facing. It may translate names and shapes of incoming arguments, but it never translates, loosens, or reinterprets path, command, or capability declarations. Path-looking strings remain path-looking strings through the bridge so that the gatekeeper validates the values the client actually supplied, not a sanitized projection of them. Unknown parameters that no operation descriptor declares are rejected; they are never forwarded downstream.

---

## 7. Security, Threat Modeling & Error Boundaries

### 7.1 Threat Model

The subsystem's central assumption, restated from the microkernel specification, is that every external AI caller is untrusted. The transport boundary is treated as hostile by default. The principal threats are as follows.

**Path traversal and system escape.** A malicious or erratic model may issue a path argument that attempts to address files outside the workspace, whether through absolute paths, parent-directory traversal, symlink redirection out of the perimeter, or encoded path forms. The defense is the inescapable gatekeeper: canonical path resolution followed by containment comparison against the anchored workspace root, applied identically to every argument of every invocation on every transport.

**Command injection and dangerous execution.** A model may shape a command argument to conceal a destructive or network-exfiltration action. The defense is the shared dangerous-command detector, applied as a mandatory stage, which inspects command-shaped inputs for known dangerous patterns and rejected execution families before invocation.

**Capability escalation.** A model may attempt to invoke an operation whose required capabilities are not provisioned in the current runtime. The defense is the pipeline's capability verification stage, which refuses operations whose capability tokens are unresolvable in the service container.

**Denial of service through resource exhaustion.** A model may enqueue unbounded parallel invocations or long-running operations. The defense is the request concurrency cap together with the execution timeout applied at the transport layer, both honored by the kernel cancellation signal.

**Privileged transport access.** A remote host might be tempted to treat the loopback-bound server as reachable network infrastructure. The defense is the loopback-only default binding, the port verification at launch, and the requirement that a routable interface be authorized only by explicit administrative override.

### 7.2 Fail-Closed Error Envelopes

> **Implementation status:** Planned (D14). No four-field envelope exists yet. Current failures return sanitized prose with a coarse code; a reference identifier is issued only for internal faults, and per-call diagnostics are not written to the server log. Stack traces and workspace paths are stripped, which is the part of this section that is enforced. See §9.

Every failure of the subsystem exits through a structured error envelope, and the envelope is fail-closed: a failure that cannot be classified receives the same non-specific diagnostic as a suspected attack, never a copious disclosure.

The envelope carries exactly four fields: a stable, documented error category; a human-readable summary that is safe to present to an end user; a reference identifier that allows an operator to correlate the failure with server-side logs; and a remediation hint derived from the failure stage. The envelope deliberately omits internal stack traces, internal module names, source paths, and any memory-level detail. The full diagnostic, including the stack trace, is written to the server's diagnostic stream, where it remains visible only to the operator and is excluded from any payload returned to the client.

The class of error is selected from the transport stage on which the failure occurred: rejection because the workspace anchor was missing, rejection because a path escaped the boundary, rejection because a command was flagged dangerous, rejection because a capability was unsatisfiable, expiry because the execution timed out, and refusal because an unknown parameter was supplied. Contained system faults are surfaced as generic execution failures with a reference identifier, so a client learns that an action failed without learning anything it could use to probe deeper.

All of the above protects the client from the server; the socket policy protects the server from the network; and the fail-closed envelope protects the boundary from both. No error from a poisoned invocation may leak information about the host filesystem, the editor environment, or the internal structure of the engine.

---

## 8. Phased Implementation Roadmap

The subsystem is delivered in three phases, each independently shippable and each gated by its own quality bar.

### 8.1 Phase 1: Standalone Package Scaffolding, Schema Converter, and Local Transport Engine

This phase establishes the platform-agnostic foundation.

- Create the `packages/mcp` package with a declared dependency boundary against the kernel and the protocol contracts, and wire the packaging rule that forbids application-layer imports.
- Implement the schema converter that synthesizes the tool catalog from the operation registry's prompt descriptors.
- Implement the parameter normalization bridge with typed coercion and unknown-parameter rejection.
- Implement the engine core with the lifecycle state machine, the gatekeeper routing discipline, and the reversibility wiring against the kernel pipeline.
- Implement both transports: the loopback-bound HTTP and Server-Sent Events transport with ephemeral and fixed port allocation, and the stdio transport with clean-channel framing and end-of-stream termination.
- Deliver unit coverage for catalog synthesis, normalization, containment rejection, and both transport framing paths.

Exit criteria: a headless process may launch the server, list the synthesized catalog, invoke an operation, and receive a structured result, without any editor process present.

### 8.2 Phase 2: Management Panel Controller and Workspace Sensor Integration

This phase connects the engine to the editor host at the data and control level only.

- Implement the workspace sensor inside `apps/vscode` that observes the active folder and pushes the anchor to the server on open and on switch.
- Implement the MCP Server section of the Management Panel with live status rendering, Start and Stop controls, and the Auto-On setting honored during extension activation.
- Implement the configuration export utility that generates client-ready configuration from live server state.
- Implement server lifecycle supervision so that panel commands and engine state transitions stay consistent, including clean drain on stop and port release on restart.

Exit criteria: opening a project with Auto-On enabled boots a visible, anchored, controllable server; switching projects instantly re-anchors enforcement; exporting a client configuration produces a working handshake for a real external client.

### 8.3 Phase 3: Automated Integration Test Harness

> **Implementation status:** Superseded (D15). On 2026-10-20 the Architect narrowed Phase 3 to a bridge contract suite rather than a duplicate of the kernel rejection matrix. What shipped is recorded in §9. The exit criteria below remain the original, unmet wording.

This phase nails the subsystem's contract under continuous verification.

- Build an integration harness that boots the engine in a controlled process, launches real transports, and asserts tool listing over each transport.
- Assert execution round trips over both transports, including successful execution, boundary violation rejection, dangerous-command rejection, anchor-missing rejection, and timeout expiry, each verified against the structured error envelope.
- Assert reversibility end to end, confirming that a model-invoked file mutation is listable in history and revertible with a single action.
- Wire the harness into the continuous integration pipeline so every commit is verified against the full transport matrix.

Exit criteria: the integration suite runs green in CI across the streaming transport and the stdio transport, with the zero-trust rejection cases and the reversibility guarantee asserted on every run.

---

## Conformance Checklist

The following invariants bind every phase and every future change to this subsystem. Where
the shipped system satisfies an invariant only partially, the bullet says so and points at
§9; the invariant itself is not weakened.

- No protocol code exists inside the editor host; the host is a sensor and a remote control only.
- Every external invocation traverses the kernel validation layer; there is no bypass path.
- Every executed operation is snapshot-captured and reversible regardless of caller identity. — enforced; invocation provenance does not yet exist (D6).
- Every failure returns a fail-closed structured envelope with no stack or path disclosure. — planned (D14); path and stack sanitization is enforced today.
- The tool catalog is synthesized on demand and is never duplicated by hand. — enforced for the tool list; the parameter map is a guarded second table (D13).
- Default bindings are loopback-only, and port conflicts fail closed at launch.
- The MCP package imports no editor or application layer, enforced at build time.

## 9. Implementation Status Register

This register is the single source of truth for what the subsystem actually does. The body of
this document states the target contract; this section states which parts of it are real.

Vocabulary:

- **Enforced** — the text matches behaviour, and a named test or module proves it.
- **Deviated** — behaviour differs by an accepted architectural choice.
- **Planned** — promised by this document, not built; no code path exists.
- **Superseded** — replaced by a later Architect decision.

### 9.1 Divergence Register

| ID | Section | Requirement | Status | Evidence |
|---|---|---|---|---|
| D1 | §2 | MCP depends only on kernel and protocol contracts | Deviated | The package also depends on `@brud/core` (`packages/mcp/src/bootstrap.ts`). The ban on editor and UI imports is enforced by `scripts/check-boundaries.mjs` in CI. |
| D2 | §3.1 | Catalog synthesized from kernel prompt descriptors | Deviated | Synthesis reads the shared tool registry (`packages/mcp/src/catalog.ts`); the kernel does not yet expose the descriptors this section assumes. |
| D3 | §3.1 | Engine owns a five-phase lifecycle state machine | Deviated | Lifecycle is tracked by the host service with four states (`apps/vscode/src/mcp/McpServerService.ts`); the engine itself has no state machine. |
| D4 | §3.2 | Anchor delivered through a channel; unanchored server refuses work | Deviated | The workspace is required and canonicalized at start-up (`packages/mcp/src/cli.ts`, `packages/mcp/src/bootstrap.ts`); switching projects restarts the server and assigns a new port. |
| D5 | §3.3 | Containment and command safety are unconditional | Deviated | Both are gated by project settings (`packages/core/src/settings/types.ts`); the MCP layer adds no gate. With containment disabled, the perimeter is advisory. |
| D6 | §3.4 | Each machine action is linked to its originating invocation | Planned | History records an empty prompt and no origin marker (`packages/core/src/bridge/legacyBridge.ts`), so AI-originated changes are not distinguishable. |
| D7 | §4.1 | SSE stream, provisional handles, lifecycle events, keep-alive | Deviated | The HTTP transport is stateless with JSON responses (`packages/mcp/src/http.ts`); there is no event stream. |
| D8 | §4.1 | Deadline terminates the invocation; client abort cancels it | Enforced | Deadline race plus signal propagation (`packages/mcp/src/limits.ts`, `packages/core/src/file-operations/index.ts`), proven by `packages/mcp/src/__tests__/http.test.ts`, `packages/mcp/src/__tests__/server.test.ts` and `packages/core/src/file-operations/abort.test.ts`. |
| D9 | §4.2 | End-of-stream enters a draining phase | Planned | Framing, clean diagnostics and the deadline are enforced (`packages/mcp/src/server.ts`, `packages/mcp/src/cli.ts`); draining is left to the transport library. |
| D10 | §4.3 | Launch verifies the port is not a peer Brud server | Planned | Only bind-conflict detection exists (`packages/mcp/src/http.ts`). |
| D11 | §5 | Auto-On stored in workspace configuration | Superseded | Stored as `mcpAutoOn` in `.brud/settings.json`, Architect decision of 2026-10-20 (`packages/core/src/settings/types.ts`). |
| D12 | §5 | Export carries transport descriptor, authorization preamble, consumer selection, live anchor | Planned | The export is a single URL block (`apps/vscode/src/mcp/mcpConfig.ts`). |
| D13 | §6.1 | Every documented operation yields exactly one tool; no hand-maintained mirror | Enforced with a caveat | Twenty documented operations become twenty tools and `get_tool_info` is deliberately not a client tool; the tool list is generated, but the parameter map is a second table guarded by cross-checks (`packages/mcp/src/normalize.ts`, `packages/mcp/src/__tests__/catalog.test.ts`, `packages/mcp/src/__tests__/normalize.test.ts`). |
| D14 | §7.2 | Four-field fail-closed envelope with category, summary, reference and remediation | Planned | Failures return sanitized prose with coarse codes; a reference identifier is issued only for internal faults (`packages/mcp/src/dispatch.ts`). Path and stack sanitization is enforced. |
| D15 | §8.3 | Full cross-transport rejection matrix in CI | Superseded | Phase 3 was narrowed by Architect decision of 2026-10-20 to a bridge contract suite plus transport enforcement; both are in CI. The kernel rejection matrix remains covered at the kernel layer. |
| D16 | Checklist | All seven invariants hold | Mixed | See §9.2. |

### 9.2 Conformance Invariants

| Invariant | Status | Note |
|---|---|---|
| No protocol code inside the editor host | Enforced | The editor imports a start function and a status service only. |
| Every invocation traverses the kernel validation layer | Enforced | One dispatch path; no alias or bypass. |
| Every executed operation is snapshot-captured and reversible | Enforced, with caveat | Reversibility holds for machine writes; invocation provenance does not exist (D6). |
| Every failure returns a fail-closed structured envelope | Planned | Sanitization holds; the four-field envelope does not exist (D14). |
| Catalog synthesized on demand, never duplicated by hand | Enforced, with caveat | Tool list is generated; the parameter map is a guarded second table (D13). |
| Loopback-only default, port conflicts fail closed | Enforced | Peer-server identity is not checked (D10). |
| MCP imports no editor or application layer | Enforced | Build-time script in CI. |

### 9.3 Maintenance Rule

A change that ships behaviour differing from this document must add or update a row here in
the same change, and must cite a code path or a test. A row may not cite an unverifiable
claim. When a planned row becomes enforced, its status changes rather than its row being
deleted, so the history of the gap remains visible.
