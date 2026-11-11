# Brud Code Engineering Documentation

## Architecture Overview

Brud Code is a monorepo with clear separation between the platform-agnostic core engine, the UI layer, and platform-specific adapters.

## Monorepo Structure

```
packages/
├── kernel/         — Standalone zero-dependency microkernel orchestrator (ServiceContainer, ExecutionPipeline)
├── core/           — Pure TypeScript engine, zero platform dependencies
├── protocol/       — Message contracts between layers
├── ui/             — React application with design system
├── adapters/
│   └── vscode/     — Archived VS Code adapter (under deprecated/); clients live in the product repository
```

## Core Engine

### `@brud/kernel` — Microkernel Orchestrator

`kernel/` is a standalone, zero-dependency TypeScript package that provides the `ServiceContainer` and `ExecutionPipeline` — the unified dispatch layer for all userspace operations. It enforces deterministic workspace sandboxing, wraps execution lifecycles in fault-tolerant panic boundaries, and routes all tool invocations through the microkernel registry.

### `@brud/core` — Archived Platform-Agnostic Engine

> **As of Phase 11 (2026-11-05), this engine is archived at `deprecated/packages/core/`.** The live engine is `@brud/kernel` plus the official plugins under `packages/plugins/`, hosted by `@brud/daemon`. The description below is historical reference for the pre-rollout implementation; it is no longer a live dependency and `deprecated/` is not maintained.

The core engine is platform-agnostic TypeScript. It contained:

- **Parser** — Legacy and YAML format support for Brud blocks (`packages/core/src/parser/`)
- **File Operations** — 21 operation types including search/replace, create, delete, rename, move, copy, append, directory operations, bulk multi-file operations, structure extraction, codebase metadata, and file read operations (`packages/core/src/file-operations/`)
- **History** — Session recording with pre/post snapshots, soft-delete via trash, revert per operation or full session, 7-day retention (`packages/core/src/history/`)
- **Terminal** — Single, sequential, parallel, and conditional execution with interactive CLI support and answer feeding (`packages/core/src/terminal/`)
- **Search** — File name search with glob patterns, recursive and filtered queries (`packages/core/src/search/`)
- **Read Engine** — File reading with import following, recursive import resolution, configurable depth (`packages/core/src/read-engine/`)
- **Tool Registry** — Self-documenting tool discovery and result rendering (`packages/core/src/tool-registry/`)
- **Validation** — Dangerous command detection, workspace boundary enforcement, path sanitization (`packages/core/src/validation/`)
- **Structure Extractor** — Token-efficient directory tree extraction (`packages/core/src/structure-extractor/`)
- **Metadata Extractor** — Codebase metadata analysis (`packages/core/src/metadata-extractor/`)
- **Import Resolver** — Recursive import dependency resolution (`packages/core/src/import-resolver/`)

## Key Design Patterns

1. **Tool Result Registry** — Extensible result rendering. Tools self-register renderers via `globalToolRegistry`.
2. **Operation Executor Pattern** — Each operation type has isolated switch-case logic in `executeFileOperations`.
3. **Platform-Agnostic Engine** — Zero VS Code API in the live engine (`packages/kernel` and the official plugins). Platform dependencies are injected through kernel services and typed plugin context. The legacy core, formerly at `packages/core`, is archived at `deprecated/packages/core/`.
4. **Adapter Pattern** — Platform-specific code isolated in `packages/adapters/vscode/`. The `FileSystem` interface abstracts file I/O; `TerminalExecutor` abstracts terminal execution.
5. **Snapshot System** — Hybrid full pre-snapshot + diff post-snapshot for efficient revert. Trash-based soft-delete with 7-day protection.
6. **Workspace Validation** — Every file path is validated against workspace boundaries before any operation executes.
7. **Microkernel Dispatch** — All 21 operations route through the `@brud/kernel` `ExecutionPipeline`, providing deterministic sandboxing, panic boundaries, and a unified capability registry.
8. **Dependency Flow** — Packages follow a strict dependency chain: `@brud/protocol` → `@brud/kernel` → official plugins/daemon. The pre-Phase-11 chain (`@brud/core` → `@brud/vscode-adapter` → client applications) is archived in `deprecated/`; clients live in the product repository, not in this foundation.

## Build System

- npm workspaces for monorepo management
- TypeScript project references for incremental builds
- Vite for webview UI bundling (`packages/ui/`)
- GitHub Actions CI pipeline (`ci` workflow)

## Testing

- Kernel, plugin, and daemon test suites
- Real file system operations (no mocking of I/O)
- Parser tests for legacy and YAML format parsing
- Validation tests for dangerous command and workspace boundary detection
- History tests for snapshot, revert, and trash operations
- Run with `npm run test` (kernel and daemon) or `npm run ci` (build, kernel, boundaries, lint)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Architecture deep-dives are in [docs/arch/](docs/arch/) for detailed module specifications (History, Terminal, etc.).