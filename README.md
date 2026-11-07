# Brud

**An AI-Native Runtime for local agents.**

Build the agent. Brud handles the runtime.

Brud provides the primitives an agent needs to modify a workspace with control and traceability: file operations, terminal execution, a reversible history ledger, and capability-scoped plugins, exposed through a local JSON-RPC interface.

Brud is a runtime layer built on top of Node.js, providing the missing primitives for safe, deterministic AI agent execution.

If Node.js has NPM packages, Brud has capability-scoped Plugins.

It is intended for teams building coding agents, editor integrations, and automation tools that need a dependable execution layer rather than a collection of scripts.

This repository contains the engine, the local daemon, the official plugins, and the Brud Code reference client.

[![Quality Gate](https://github.com/rahatarch/brud/actions/workflows/quality.yml/badge.svg)](https://github.com/rahatarch/brud/actions/workflows/quality.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: developer preview](https://img.shields.io/badge/status-developer%20preview-orange.svg)](#project-status)

---

## Why build on Brud

- **Workspace containment is enforced before execution.** Every file operation resolves to a canonical path and is checked against the workspace boundary, the protected-path policy, and the user's `.brudignore` rules.
- **Mutations are reversible.** The history service records pre- and post-mutation states in a SQLite ledger backed by content-addressed storage, and can revert an operation or a complete session.
- **Permissions are explicit.** Plugins declare the capabilities they require. The kernel exposes only the handles that a plugin declared, and undeclared access is rejected at the boundary.
- **Hosts remain decoupled.** The kernel does not depend on an editor API. The daemon exposes one tool interface over a local socket or stdio, so a VS Code extension, a CLI, and a desktop application can share the same execution layer.
- **The official plugin set is included.** Filesystem, reader, search, structure, catalog, terminal, MCP bridge, and prompt-vault plugins are maintained in this repository.

## Quick start

> **Developer preview.** The npm packages are not published yet. The commands below build the engine from source. Public interfaces may change before version 1.0.

### Prerequisites

- Node.js 22.13 or newer, required by `node:sqlite`

### Build from source

```bash
git clone https://github.com/rahatarch/brud.git
cd brud
npm install
npm run build:all
npm run build \
  --workspace @brud/plugin-filesystem \
  --workspace @brud/plugin-terminal \
  --workspace @brud/plugin-reader \
  --workspace @brud/plugin-search \
  --workspace @brud/plugin-structure \
  --workspace @brud/plugin-catalog \
  --workspace @brud/plugin-user-prompts \
  --workspace @brud/plugin-mcp-bridge
```

### Start the daemon

```bash
node packages/daemon/dist/cli.js --workspace /path/to/project --stdio
```

The `--stdio` mode serves the MCP stdio transport. A custom application does not need to start the daemon manually; the client below starts it on demand.

### Connect a client

```ts
import { connectToDaemon } from '@brud/daemon';

const client = await connectToDaemon({ workspaceRoot: process.cwd() });

const { result } = await client.request('tools.execute', {
  name: 'create_file',
  input: {
    path: 'src/generated.ts',
    content: 'export const ready = true;\n',
  },
});

if (result.status !== 'success') {
  throw new Error(result.error ?? result.message ?? 'Tool execution failed');
}

await client.close();
```

`@brud/daemon` is a workspace package in this repository. External applications can send the same JSON-RPC methods over the local socket; no published client package is available yet.

## Core concepts

| Term | Definition |
|:---|:---|
| **Kernel** | The in-process core that owns the service graph, policy enforcement, and execution pipeline. |
| **Service** | A privileged built-in component that provides a core capability, such as workspace resolution, file I/O, validation, history, settings, or terminal execution. Brud refers to these as Level-1 services. |
| **Plugin** | A module that registers tools and declares the permissions it requires. |
| **Tool** | A named operation an agent invokes, such as `create_file`, `search_replace`, or `terminal_command`. |
| **Daemon** | The local process that hosts the kernel and exposes tools over JSON-RPC. |
| **Ledger** | The SQLite history store that records mutation pre- and post-states and supports reversal. |

## Architecture

```text
Agent or host application
        │
        │ JSON-RPC over a local socket or stdio
        ▼
Brud Daemon ── authenticates the client and scopes the workspace
        │
        ▼
Brud Kernel ── service graph, policy enforcement, execution pipeline
        │
        ├── Level-1 services
        │   Workspace · FileSystem · Validation · History · Settings · Terminal
        │
        └── Plugins (capability-scoped)
            Filesystem · Reader · Search · Structure · Catalog · Terminal
            MCP Bridge · User Prompts
```

A request enters through the daemon, is authenticated and bound to a workspace, and is dispatched by the kernel. The kernel resolves the requested tool, applies the owning plugin's capability scope and the path and command policy, and executes the operation through the relevant service or plugin. Kernel-mediated file mutations are recorded in the history ledger before and after execution.

## Capabilities

| Capability | Provided by | Operations |
|:---|:---|:---|
| File mutation | Filesystem plugin | Create, delete, rename, move, copy, and append files; create, delete, and move directories; multi-file append; search and replace; multi-file search and replace |
| File reading | Reader plugin | `read_file`, `read_files`, `read_directory` |
| Search | Search plugin | `search_files` |
| Project structure | Structure plugin | `extract_structure`, `codebase_metadata` |
| Tool discovery | Catalog plugin | `get_tool_info` |
| Terminal execution | Terminal plugin | `terminal_command`, `terminal_interactive` |
| History and reversal | Universal History service | SQLite ledger, content-addressed states, operation and session reversal |
| MCP integration | MCP Bridge plugin | stdio and HTTP transports for the Model Context Protocol |
| Prompt storage | User Prompts plugin | Workspace-scoped prompt vault |

## Security model

Brud enforces policy at the kernel boundary, before an operation reaches the filesystem or a process.

### Enforced controls

- **Workspace boundary.** Paths are resolved to canonical absolute paths and checked for traversal and symlink escapes before execution.
- **Protected paths.** The kernel denies access to `.git`, `.brud/history`, `.brud/settings.json`, and `.brudignore`, including all descendants.
- **User policy.** `.brudignore` rules are loaded once per workspace and applied to every path evaluation. The kernel does not allow tools to read or modify the ignore file itself.
- **Command validation.** Terminal commands are screened against a configurable denylist of destructive patterns. The policy is frozen at kernel boot.
- **Capability-scoped plugins.** A plugin manifest declares permissions such as `fs:read`, `fs:write`, `history:read`, `history:write`, `tools:register`, `tools:execute`, `terminal:execute`, and `telemetry:emit`. The kernel exposes only the handles that the plugin declared.
- **Daemon authentication.** On POSIX systems, the local runtime directory is user-private (`0700`), and clients complete a token-based handshake before issuing requests.
- **History access control.** Plugins interact with the ledger through abstracted APIs. Raw ledger access is reserved for the client and for official plugins reading their own namespace.

### Current boundaries

- Plugins execute in the same process as the kernel. The kernel grants only the capabilities a plugin declared; this does not isolate hostile code.
- Operating-system sandboxing is not implemented. Process isolation for plugins is deferred to a future design decision.
- Terminal commands are screened by a denylist, not contained by an operating-system sandbox. A command that passes validation can write outside the workspace, and those writes are outside the history ledger.
- History reversal covers kernel-mediated file operations. Unrecorded paths cannot be reverted, and directory-state reversal has documented limits.
- The project is pre-1.0, and interfaces may change.

## Repository layout

The repository is an npm workspace monorepo. The engine packages, official plugins, and reference client are versioned together.

| Path | Contents |
|:---|:---|
| `packages/kernel` | Microkernel: service container, capability enforcement, validation, execution pipeline, Level-1 services |
| `packages/protocol` | JSON-RPC contracts and shared types |
| `packages/daemon` | Local host, transport, authentication, CLI, and client |
| `packages/plugins/*` | The eight official plugins |
| `packages/ui` | React webview interface |
| `apps/vscode` | Brud Code, the reference VS Code extension |
| `apps/web` | Project website and documentation (Next.js static export) |
| `tests` | Integration tests |
| `docs` | Architecture, standards, and release documentation |
| `deprecated` | Archived pre-microkernel engine, retained for reference only |

## Project status

Brud is in developer preview. The engine, daemon, protocol, and plugins are under active development, and public interfaces may change before version 1.0. No npm packages are published yet.

The reference VS Code client, Brud Code, is being migrated from the archived engine to the daemon protocol. Until that migration completes, parts of the client use the code in `deprecated/`.

## Development and testing

```bash
npm run typecheck
npm run lint
npm run test:kernel
npm run test:daemon
npm run ci
```

`npm run ci` builds the engine, runs the kernel test suite, checks package boundaries, and runs the linter. The default daemon suite covers protocol dispatch and client behavior; additional adversarial transport tests are located in `packages/daemon/src/__verification__/`.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — repository and engine structure
- [Engine architecture standard](docs/architecture/ENGINE_ARCHITECTURE_STANDARD.md) — service boundaries and kernel contracts
- [Microkernel rollout plan](docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md) — migration record and design decisions
- [History security model](docs/architecture/HISTORY_SECURITY_MODEL.md) — ledger access model and threat boundaries
- [PRIVACY.md](PRIVACY.md) — data handling
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guidelines
- [CHANGELOG.md](CHANGELOG.md) — release history

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report security vulnerabilities privately to the maintainers rather than in a public issue.

## License

Brud is released under the [MIT License](LICENSE).

Brud is developed by Akkhar-Labs.