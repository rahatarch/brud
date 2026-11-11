# BEAS-0001: The Brud Engine Architecture Standard

- **Identifier:** BEAS-0001
- **Domain:** Systems Architecture, Core Invariants & Contributor Standard
- **Status:** Target Architecture / Active Rollout (Binding for all new implementations)
- **Audience:** Core Engineers, Contributors, System Integrators, Platform Developers

---

## 1. System Identity and Fundamental Mandate

While the initial product surface distributes as an extension for Visual Studio Code, **the core Brud engine is not an IDE extension**.

**Brud is an autonomous, platform-agnostic, runtime-agnostic execution engine.**

The engine provides deterministic code execution, multi-file transactional operations, and automated validation. Host environments—such as the Visual Studio Code extension host, command-line interfaces (CLIs), Model Context Protocol (MCP) servers, webviews, and headless automation daemons—are boundary adapters. Their sole responsibility is to translate external events and project engine output.

### 1.1 The Four Orthogonal Invariants
The core engine is governed by four primary design invariants:

1. **Platform Independence:** The engine core contains zero direct dependencies on specific operating systems, proprietary editor host APIs, or desktop UI runtimes.
2. **Language and Framework Agnosticism:** Execution logic, diff generation, and validation pipelines operate neutrally across programming languages and project structures.
3. **Runtime Decoupling:** Core engine logic is authored against standard ECMAScript / Web platform abstractions, enabling target execution across Node.js, Bun, Deno, isolated worker threads, and containerized runtimes.
4. **Input Source Agnosticism:** Operations are ingested and executed exclusively on syntactic and contractual validity. Whether a command originates from a manual human prompt, an HTTP/WebSocket payload, an automated language-model agent loop, or an MCP JSON-RPC call, the engine processes the operation through an identical execution pipeline.

---

## 2. Hexagonal Architecture and The Zero-Leakage Invariant

The repository enforces a Ports and Adapters (Hexagonal) pattern. The codebase is bifurcated into **Core Domain Systems** and **Boundary Adapters**.

```text
                ┌────────────────────────────────────────────────────────┐
                │                   Boundary Adapters                    │
                │     packages/plugins/MCPBridge  •  packages/daemon     │
                └───────────────────────────┬────────────────────────────┘
                                            │
                                            ▼ (Strict Protocol Messages)
                ┌────────────────────────────────────────────────────────┐
                │                 Sovereign Engine Core                  │
                │   @brud/kernel  •  official plugins  •  @brud/protocol │
                └────────────────────────────────────────────────────────┘

```

### 2.1 The Zero-Leakage Law

**No domain, execution, or business logic may reside inside boundary adapters.**

1. **Single Source of Truth:** All AST manipulations, validation algorithms, state transitions, diff calculations, patch generators, and pipeline orchestrations belong exclusively in the engine (`packages/kernel`, `packages/protocol`, and the official plugins that replace the legacy core).
   - `packages/protocol`: Owns message schemas, IPC payloads, and serializable protocol contracts.
   - `packages/kernel`: Owns the execution pipeline, dependency injection container, lifecycle arbitration, Level-1 services, and the `BrudTools` tool registry and parser.
   - `packages/core`: Archived at `deprecated/packages/core/` in Phase 11 (2026-11-05, D-14/D-17). It was frozen reference material under D-17 and is no longer part of the live codebase. The live engine is `packages/kernel` plus the official plugins under `packages/plugins/`.
   - `brud.tools.filesystem`: Owns diffing and patch generation in Phase 9, operating over `BrudTools.parseAndRoute` and the patch matcher moved into that plugin.
2. **Prohibition of Duplicate Business Logic:** If a capability is required by multiple surfaces (for example, both a future CLI binary and the VS Code panel), implementing that capability within the adapter layer is strictly forbidden. The logic must be implemented in the core engine, exposed via `@brud/protocol`, and consumed uniformly.
3. **The Deletion Invariant:** If any adapter is removed in its entirety, zero core domain logic, verification contracts, or execution capabilities are lost.

### 2.2 Boundary Adapter Constraints

Boundary adapters are restricted to:

1. Ingesting host events and serializing them into standardized `@brud/protocol` messages.
2. Injecting platform-specific driver implementations (e.g., concrete filesystem and terminal implementations) into the kernel container during boot.
3. Deserializing engine responses and rendering them through host-native interfaces (e.g., terminal output, webview components, or remote API response bodies).

Adapters are strictly prohibited from implementing private file-inspection routines, bespoke state machines, or bypass pathways around the core validation pipeline.

---

## 3. Microkernel Orchestration Topology

The execution core is structured as a microkernel. The kernel (`@brud/kernel`) does not execute concrete file mutations or domain workflows directly; it orchestrates them through registered handlers and services.

### 3.1 Kernel Responsibilities

The kernel serves as the central orchestrator, dependency container, and capability arbiter:

- **Dependency Injection Container:** Manages service registration via typed tokens (`IServiceContainer`), sealed post-boot via `freeze()`.
- **Operation Registry:** Dispatches typed operations through an extensible registry (`OperationRegistry`).
- **Execution Pipeline:** Executes operations through middleware chains with call-depth limits and panic boundaries (`ExecutionPipeline`).
- **Capability Gating:** Verifies that required service capability tokens are registered in the active container before executing operations.
- **Context Dispatch:** Mediates execution context (`ExecutionContext`) providing operations with scoped access to registered services.

---

## 4. Virtual File System and Inter-Service Communication (IPC)

### 4.1 FileSystem Port & VFS Target

In the live engine, file input/output is abstracted through the kernel `FileSystem` service (`FileSystemToken` in `packages/kernel/services/BrudFileSystem/descriptor/tokens.ts`), registered in the kernel container at boot as `brud.core.filesystem`. The legacy `FileSystem` interface formerly at `packages/core/src/types/filesystem.ts` is archived in `deprecated/` and is not maintained.

- **Current Invariant:** Domain services and operation handlers must interact with disk resources via the injected `FileSystem` port rather than calling Node.js `fs` or `fs/promises` directly. Legacy direct filesystem calls remain only in the archived engine at `deprecated/packages/core/` (frozen under D-17, relocated byte-identical in Phase 11 under D-14); that refactor is retired.
- **Target Rollout:** The engine is transitioning to a sovereign Virtual File System (VFS) gateway managed directly by the kernel, enabling transparent sandboxing, in-memory virtual layers, path remapping, and granular file access auditing.

### 4.2 Inter-Service Communication & The No-Peer Invariant

**Level 1 core subsystems must remain decoupled from direct peer-to-peer dependencies.**

- **Current Implementation:** Subsystems and operation handlers access dependencies strictly through the kernel's `ExecutionContext` and typed DI tokens. Direct cross-service couplings that bypass the context container are prohibited.
- **Target Rollout (Mediated IPC Bus):** As the service topology expands, inter-service requests will be mediated through a central kernel dispatch bus, enabling transparent request tracing, capability token verification, and lifecycle hooks between independent system services.

---

## 5. Two-Tier Service Architecture and Plugin Lifecycle

The platform enforces a two-tier service taxonomy balancing immutable system integrity with open extensibility.

| Dimension | Level 1: System Core Services | Level 2: Sandboxed Plugins |
| --- | --- | --- |
| **Registration Phase** | Boot Initialization (Static Core Syntax) | Runtime Dynamic (Plugin API — Target Rollout) |
| **Container Mutability** | **Immutable / Frozen** post-boot | Dynamic registration and unloading |
| **Trust Boundary** | Core Engine Privileged | Sandboxed / Capability-Scoped |
| **Domain Scope** | File Ops, History, Validator, Telemetry | Custom Tools, Linters, External Agents |

### 5.1 Level 1: System Core Services (Frozen Core)

System Core Services provide the baseline capabilities of the engine:

- Registered during the kernel boot phase.
- Once initialization concludes, the container transitions to an immutable state (`serviceContainer.freeze()`). Modifying or monkey-patching Level 1 services at runtime is prohibited.
- Registered Level 1 service tokens include:
  - `brud.core.filesystem`: Abstract file operations.
  - `brud.core.terminal`: Terminal process execution.
  - `brud.core.universalHistory`: Session history and reversal (`IUniversalHistoryService`).
  - `brud.core.history`: Journal-driven checkpoint/undo history (`IUniversalHistory`).
  - `brud.core.settings` and `brud.core.settings.reader`: Configuration resolution (frozen snapshot and read-only snapshot).
  - `brud.core.workspace`: Canonical workspace identity and path translation.
  - `brud.core.validation`: Pre-execution validation gate.
  - `brud.core.tools`: `BrudTools` tool registry, certification, schema gate, dispatch table, and `[BRUD]` parser routing.
  - `PluginManager`: Plugin manager (legacy id, frozen until Phase 11).
  - Telemetry sink: planned (not implemented at HEAD); no `TelemetryTokens.Service` exists.

### 5.2 Level 2: Sandboxed Plugins (Target Specification)

*Note: Level 2 dynamic plugin loading is an active architectural target under development.*

1. **Lazy-Start Architecture:** The engine will index lightweight plugin manifests at boot without loading implementation modules. Plugin execution environments and view layers initialize only upon explicit invocation.
2. **Protected Execution Boundaries:** Plugins will execute in isolated sandboxes and interact with the workspace exclusively via the public Plugin API, gated by explicit capability scopes.
3. **Inherited Security and Rollback Guarantees:** Third-party plugins will not author custom validation, rollback, or telemetry infrastructure. When an operation is submitted through the Plugin API:
   - The kernel pre-validates inputs via the global Validation Service.
   - The kernel snapshots affected resources via the History Service.
   - The kernel logs the execution trace via the Telemetry Service.

---

## 6. Abstract State Transitions and Rollback Guarantees

The State and History subsystem guarantees workspace recoverability through transaction-style snapshot and rollback mechanisms.

### 6.1 Persistent History Model

The active history engine is specified by [`BRUD_HISTORY_ENGINE_SPEC.md`](./BRUD_HISTORY_ENGINE_SPEC.md); this section records the binding architecture and does not restate that specification's detailed persistence rules.

- **Store:** `UnifiedHistoryStore` (`packages/kernel/services/UniversalHistory/unified/store/`) opens the single SQLite database `.brud/history/universal.db` with `STRICT` tables, foreign-key-enforced type registration, JSON `CHECK` constraints, WAL mode, and `busy_timeout = 5000`.
- **Content addressing:** Payloads of up to 64 KiB are stored inline in `contents.inline_data`; larger payloads are offloaded to `cas/<aa>/<sha256>` under `.brud/history/`, sharded by the first two hex digits of the SHA-256 digest. Content is re-hashed before write and on every read.
- **Service and reversal:** `UnifiedHistoryService` owns recording, sessions, and schema-at-registration; `ReversalEngine` (`unified/engine/ReversalEngine.ts`) owns linear undo/redo/checkpoint rollback and session reversal.
- **Degraded operation:** A read-only or newer-schema database opens degraded: boot succeeds, recording is a no-op, and writes and reversals are refused.

Test doubles of production contracts are forbidden in this repository (D-18; ROLLOUT-0001 §Appendix G, `docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md`). Setup helpers that wire real implementations into a test harness are permitted.

### 6.2 Atomic Operation Batches and Session Reversal

Operations do not execute as uncoordinated file mutations:

- Operations are grouped into discrete transactional batches.
- **Rollback Guarantee:** If an operation within a multi-step batch encounters a failure, the engine plans and executes reversal through the unified history service (`IUniversalHistoryService.planReversal`, `IUniversalHistoryService.executeReversal`), returning modified files to their prior state. Reversal semantics are specified in `BRUD_HISTORY_ENGINE_SPEC.md`.
- **Stable Identifiers:** Every completed execution session records a stable identifier (`BR-YYYYMMDD-NNN`), enabling programmatic reversal across UI, API, and automated tooling surfaces.

---

## 7. Contributor Compliance and Verification Protocol

All new pull requests, refactors, and architectural additions must comply with this standard prior to integration:

1. **Adapter Boundary Check:** Confirm zero business or domain logic was added to `apps/*` or `packages/adapters/*`.
2. **Port Abstraction Audit:** Confirm no direct operating-system I/O modules (e.g., `node:fs`) are introduced into domain logic; use injected `FileSystem` ports.
3. **Container Immutability:** Verify that Level 1 service registrations occur only during boot initialization and respect container freezing.
4. **Verification Pass:** The verification suite must complete with zero errors from a clean workspace:
   - Monorepo Typecheck: `npm run typecheck`
   - Unit Test Suite: `npm run test:core`
   - History Integration Suite: `npm run test:integration`
   - MCP stdio end-to-end: `node --import tsx --test packages/daemon/src/__tests__/stdioMode.test.ts`
   - Package Boundary Audit: `npm run check:boundaries`
