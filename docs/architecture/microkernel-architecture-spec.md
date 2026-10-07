# Brud Code Engine: Microkernel Architecture Specification

## 1. Core Philosophy & Product Hierarchy

Brud Code is an extensible orchestration engine supporting multiple host targets (VS Code extension, CLI, standalone desktop IDE, headless runtime) across three product tiers:

1. **Brud Code (OSS):** Fully free, open-source core engine with zero tracking and local clipboard flow.
2. **Brud Proprietary (Mirror):** Downstream mirror including company tracking, private services, and official marketplace distribution.
3. **Brud Prime:** Flagship commercial product offering autonomous LLM execution loops directly inside the environment.

### The Inversion Invariant & Pure Orchestrator
Core (`@brud/core`) is a pure, zero-dependency TypeScript orchestrator. It does not import `node:fs`, `node:child_process`, or `vscode`. It runs identically across any JavaScript/TypeScript host:
- VS Code Extension
- Terminal CLI
- Standalone Desktop IDE
- Headless Cloud / Web Worker
- Smart TV Application (e.g. webOS / Tizen remote driver)

The host environment and concrete adapters are external concerns. Core only enforces invariant contracts, state transitions, and validation lifecycles.

---

## 2. The Operating System Metaphor (Microkernel vs. Userspace)


```

┌────────────────────────────────────────────────────────┐
│             Userspace Operation Handlers               │
│        (read_file, search_replace, create_file)        │
│                                                        │
│  - Contain isolated business and formatting logic      │
│  - Do not interact with raw disk or platform APIs      │
└──────────────────────────┬─────────────────────────────┘
│ System Call (Execution Contract)
▼
┌────────────────────────────────────────────────────────┐
│             file_operation (The Microkernel)           │
│                                                        │
│  - Neutral execution supervisor                        │
│  - Does not know or care how content is diffed         │
│  - Enforces permissions, sandboxing & lifecycle        │
│  - Coordinates rollbacks, snapshots & middleware       │
└──────────────────────────┬─────────────────────────────┘
│ Platform Ports (Drivers)
▼
┌────────────────────────────────────────────────────────┐
│              Hardware / Platform Adapters              │
│       (VS Code FS, Node.js Disk, In-Memory Mock)       │
└────────────────────────────────────────────────────────┘

```

---

## 3. Zero-Trust Isolation: "Even Your Next Folder is a Security Threat"

To eliminate lateral movement and cross-module poisoning:
1. **Zero Direct Peer Imports:** An operation folder must never import from a sibling operation folder. Sibling tools are mutually invisible.
2. **Mediation Through the Gatekeeper:** If a tool requires a capability, it requests it through the kernel broker/context. Direct coupling is forbidden.
3. **Inescapable Path Containment:** Handlers cannot resolve raw filesystem paths directly. Every path argument is validated against `workspaceRoot` by `BrudAPI.validate`.

---

## 4. Compile-Time Enforcement & Automated Pruning (Custom Brud Packager)

We do not rely on manual PR code reviews to police security standards. The custom **Brud Packager** enforces architectural invariants during the build:

1. **Unregistered Candidates:** Any file or tool not hooked into the official registration API is treated as dead code and completely excluded from the bundle.
2. **Missing Validator Rejection:** Any operation registering without binding to `BrudAPI.validate` triggers an immediate compile-time fatal build error.
3. **Automated Pruning:** Unmaintained tools that fail contracts or localized unit tests are automatically stripped from distribution bundles without breaking core engine builds.

---

## 5. Kernel Subsystems & Runtime Extensibility

- **ServiceContainer:** Typed token-based Inversion of Control (IoC) registry for platform ports (`FileSystem`, `TerminalRunner`, `TelemetryService`, `HistoryStore`).
- **OperationRegistry:** Self-registering operation handlers implementing the `OperationHandler` contract, eliminating monolithic switch-case dispatch.
- **ExecutionPipeline:** Composable onion middleware wrapping each operation with boundary checks, automatic snapshot rollback safety, and non-blocking telemetry.
- **Single Point of Truth Gatekeeper:** Centralized `BrudAPI.validate` patches instantly protect all tools and host targets without downstream edits.