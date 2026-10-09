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
│   └── vscode/     — VS Code specific FileSystem and terminal executors
apps/
├── vscode/         # VS Code extension entry point
├── web/            # Marketing and documentation website (Next.js static export)
tests/
├── integration/    — Full workflow integration tests
```

### `apps/web` — Marketing and Documentation Website

`apps/web` is a statically exported Next.js 15 site that serves as the marketing frontend and documentation hub for Brud Code. It is fully self-contained with zero runtime dependencies on the monorepo's packages or any private infrastructure. The site showcases live benchmarks, 3D interactive graphics, onboarding guides, and technical documentation. It uses `output: "export"` in Next.js to produce plain HTML/CSS/JS artifacts deployable to any standard web server or edge CDN.

## Core Engine

### `@brud/kernel` — Microkernel Orchestrator

`kernel/` is a standalone, zero-dependency TypeScript package that provides the `ServiceContainer` and `ExecutionPipeline` — the unified dispatch layer for all userspace operations. It enforces deterministic workspace sandboxing, wraps execution lifecycles in fault-tolerant panic boundaries, and routes all tool invocations through the microkernel registry.

### `@brud/core` — Platform-Agnostic Engine

The core engine is platform-agnostic TypeScript. It contains:

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
3. **Platform-Agnostic Core** — Zero Node.js, zero VS Code API in `packages/core`. All platform dependencies are injected via `FileSystem` and `TerminalExecutor` interfaces.
4. **Adapter Pattern** — Platform-specific code isolated in `packages/adapters/vscode/`. The `FileSystem` interface abstracts file I/O; `TerminalExecutor` abstracts terminal execution.
5. **Snapshot System** — Hybrid full pre-snapshot + diff post-snapshot for efficient revert. Trash-based soft-delete with 7-day protection.
6. **Workspace Validation** — Every file path is validated against workspace boundaries before any operation executes.
7. **Microkernel Dispatch** — All 21 operations route through the `@brud/kernel` `ExecutionPipeline`, providing deterministic sandboxing, panic boundaries, and a unified capability registry.
8. **Dependency Flow** — Packages follow a strict dependency chain: `@brud/protocol` → `@brud/kernel` → `@brud/core` → `@brud/vscode-adapter` → `apps/vscode`.

## Build System

- npm workspaces for monorepo management
- TypeScript project references for incremental builds
- Vite for webview UI bundling (`packages/ui/`)
- Webpack for VS Code extension bundle
- GitHub Actions CI pipeline (`ci:quick` and `ci` workflows)

## Testing

- 12+ test suites across core modules and integration
- Real file system operations (no mocking of I/O)
- Integration tests for full end-to-end workflows (`tests/integration/`)
- Parser tests for legacy and YAML format parsing
- Validation tests for dangerous command and workspace boundary detection
- History tests for snapshot, revert, and trash operations
- Run with `npm run test:core` (unit) or `npm run test:integration` (E2E)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Architecture deep-dives are in [docs/arch/](docs/arch/) for detailed module specifications (History, Terminal, etc.).