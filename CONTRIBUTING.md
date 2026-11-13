# Contributing to Brud

Thank you for your interest in Brud — the open foundation that hosts the kernel, the daemon, the services, the plugins, the protocols, and the contracts. Client applications live in the product repository.

## How to Contribute

We welcome contributions that improve the platform, fix bugs, add features, or enhance documentation. Before contributing, please review the project's architecture and design principles in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Reporting Bugs

Before submitting a bug report, please check the [issue tracker](https://github.com/rahatarch/brud/issues) to see if the issue has already been reported. When filing a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Screenshots or logs if applicable
- Your environment (OS, Node.js version, package version)

## Development Setup

1. **Fork and clone** the repository.
2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Run the full CI pipeline** to verify everything is working:

   ```bash
   npm run ci
   ```

   This runs `npm run build:all`, `npm run test:kernel`, `npm run check:boundaries`, and `npm run lint`. It does not run `npm run test:daemon`; run that separately.

4. **For a quicker feedback loop** during development:

   ```bash
   npm run test:kernel
   ```

   Use `npm run test:daemon` for the daemon transport suite and `npm run typecheck:ci` for the package typecheck.

## Project Structure

Brud Code is organized as a monorepo with npm workspaces. Key directories:

- `packages/kernel/` — Microkernel, Level-1 services, plugin runtime, and the `BrudTools` registry/parser
- `packages/protocol/` — Protocol definitions and data structures
- `packages/plugins/` — Official leaf plugins (Search, Structure, UserPrompts, Catalog, Reader, Filesystem, Terminal, MCPBridge)
- `packages/daemon/` — Host transport and JSON-RPC dispatch
- `packages/ui/` — Shared webview UI package
- `deprecated/` — Archived legacy engine and adapter (Phase 11). **Not maintained.** Do not add files or import from it.

Refer to [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of the architecture and design decisions.

## Code Style

- **TypeScript** — All code must be written in TypeScript with strict type checking enabled.
- **Formatting** — Use the project's ESLint configuration. Run `npm run lint` before committing.
- **Atomic Changes** — Each change must be minimal and context-aware. Changes should be designed to apply as a single transaction.
- **Decoupled Engine** — Core patching logic in `packages/kernel/` and the official plugins must remain free of VS Code API dependencies. Platform-specific concerns belong in the host/daemon layer. The legacy engine is archived in `deprecated/` and is not a contribution target.
- **Architectural Rules** — Every change must satisfy the binding rules in [ARCHITECTURE_RULES.md](./ARCHITECTURE_RULES.md). Read them before changing the codebase.

## Testing Requirements

Capability projection (§1.3 R3 of the rollout plan) is only as strong as the tests that exercise it. Mocked tests pass while production fails under the same capability model: a test that never touches a real driver cannot detect a containment bug, a race, or a missing index. The repository therefore enforces production-realistic, zero-mock, adversarial testing under **D-18**. The legacy engine is frozen reference material under **D-17**, archived at `deprecated/packages/core/` in Phase 11 (D-14/D-22) — it is not a test target and `deprecated/` is not maintained. New tests belong in the package that owns the surface.

**The standard (D-18):**

- **Real contract implementations.** Exercise contract implementations on real environments, not test doubles. Use `DurableNodeStorageDriver` on real temporary directories, `UniversalHistory` on real SQLite files, and `TerminalService` spawning real processes.
- **Simulated external APIs with real-shape responses.** External services (LLM APIs, package registries, HTTP endpoints, external systems) are simulated with real-shape responses, including errors, timeouts, rate limits, and malformed payloads — never mocked away with a happy-path substitute.
- **Pure functions tested directly.** Parsers, hashers, and schema validators are the unit under test; testing them directly is not a mock.
- **Adversarial coverage.** Cover the adversarial categories below for every surface you introduce or change.

**Use real implementations:**

- `DurableNodeStorageDriver` on real temporary directories for filesystem durability and containment tests.
- `UniversalHistory` on real SQLite files for history, reversal, and retention tests.
- `TerminalService` spawning real processes for terminal lifecycle, timeout, and output-cap tests.

**Do not use substitutions:**

- `InMemoryStorageDriver`, `MapPathPort`, or `TestHistoryStore` as replacements for a production contract.
- Any in-memory or fake implementation of a production contract outside the archived legacy engine (`deprecated/`). These are the subject of the de-mocking work that follows D-18.

**Setup helpers versus substitution helpers.** A setup helper wires real implementations into a test harness and is permitted; `packages/kernel/src/__tests__/support/realKernel.ts` and `packages/kernel/src/__tests__/fixtures/kernelWorker.ts` are the canonical examples. A substitution helper replaces a production contract with an in-memory or fake implementation and is forbidden outside the archived legacy engine (`deprecated/`, not maintained).

**Adversarial categories and examples:**

- **Injection** — malicious `[BRUD]` blocks and parameter injection routed through the real `BrudTools` parser.
- **Replay** — replaying the same mutation against `UniversalHistory` on real SQLite.
- **Token forgery** — forged history entries and forged plugin brand or claim records.
- **Unauthorized access** — a plugin without a capability attempting the corresponding handle, and path traversal via symlink against the real `BrudFileSystem`.
- **Malformed payloads** — malformed JSON-RPC framing and malformed tool parameters against the real transports.
- **Concurrent access** — concurrent writers to the same path through `DurableNodeStorageDriver`, and concurrent history appends against real SQLite.
- **Resource exhaustion** — oversized payloads, oversized files, and batch/read ceilings against the real reader and terminal surfaces.

**Running the suite.** Run the suite that owns the surface you changed: `npm run test:daemon` or `npm run test --workspace @brud/kernel`. All tests must pass before submitting a pull request. The CI pipeline (`npm run ci`) runs `build:all`, `test:kernel`, `check:boundaries`, and `lint`; it does not run `test:daemon`, so run that separately.

**References.** D-14/D-22 (quarantine and adapter archive), D-17 (legacy core frozen and relocated byte-identical), D-18 (the standard), plan §5.5 (`docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md`), evidence base (`.internal_docs/audits/2026-11-04_test_realism_inventory.md`).

**For codebase learners.** A codebase that tests against real drivers, real SQLite files, real processes, and real transports — and that requires adversarial cases for every new surface — is telling you its quality posture directly: it expects production failures to be found in tests, not in production. The capability model is enforced by tests that would actually fail if containment, durability, or authorization regressed.

## Utility vs. Plugin — where does my code go?

The kernel stays language-neutral: pure helpers live in the Level-1 Utility Service (`brud.core.utils`), while plugins are runtime actors that touch the world. Use this filter before adding a capability.

### Disqualifiers — if any apply, it is a plugin

- **Side effects.** Touches disk, process, network, or SQLite → Plugin.
- **AI invocation.** Registers a tool for the AI to call → Plugin.
- **Lifecycle.** Needs a settings flag, shadow mode, or hot-swap → Plugin.
- **Domain-specific is not a disqualifier.** A pure parser is a utility even if it knows TypeScript, Python, or YAML.

### Mandates — a utility must satisfy all of these

- **Mathematical purity.** Same input → same output; no side effects.
- **Zero ambient authority.** Runs with no permissions.
- **Bounded computational budget.** No ReDoS, no unbounded memory.
- **Reuse (soft).** More than one plugin may need it.
- **Zero dependency.** A utility cannot call plugins, Level-1 services, or the Kernel context. It may only call its own code, other utilities, and native language features. No `context.getFileSystem()`, no `context.executeTool()`, no `context.getSettings()`. If it needs any of those, it is a plugin.

### Decision tree

```text
Touches disk, process, network, or SQLite?   → Plugin
Registers a tool for the AI to call?          → Plugin
Needs a flag, shadow mode, or hot-swap?       → Plugin
Pure function with no permissions?            → Utility (brud.core.utils)
Kernel-wide policy or state otherwise?        → Level-1 Service
```

### Examples

- **Utilities:** `resolveImports`, `formatBytes`, `escapeRegex`.
- **Plugins:** `brud.search`, `brud.codebase.structure`, `brud.terminal`.

**References:** plan §Appendix G D-20 (`docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md`), [UTILITY_VS_PLUGIN.md](./docs/architecture/UTILITY_VS_PLUGIN.md), D-19.

## History Ledger — how plugins interact with it

The UniversalHistory ledger is the codebase's memory. It records every workspace mutation, the content behind it, and the session that produced it. Plugins interact with that ledger, but they do not possess it. The threat this section addresses is exfiltration: the ledger holds your code history and the content of deleted secrets, so raw access to it would let a malicious plugin reconstruct the user's source tree without touching the filesystem.

**Use the abstracted APIs.** Everything a plugin needs goes through `context.getHistory()`:

- `beginSession({ targets })`, `commitSession(id, outcome)` — open and close a session.
- `planReversal(id)`, `executeReversal(id)` — plan and perform a reversal.
- `hasModified(path)`, `getSessionSummary(id)` — inspect what a session touched.
- `saveMyState(key, value)`, `loadMyState<T>(key, schema)`, `hasMyState(key)`, `deleteMyState(key)` — persist typed state.

The ledger is not a general-purpose read API. If a task seems to require reading raw history, it is a signal that the plugin is operating outside its namespace or that a new abstracted method is missing — stop and raise it rather than reaching around the boundary.

**Raw byte access is prohibited.** No plugin receives raw SQLite rows, CAS blobs, or unvalidated JSON strings. The Kernel constructs every object that crosses the boundary. Namespace isolation is enforced by the Kernel: a session can only address the plugin's own namespace, and `brud.core.file` — the user's file mutation timeline — is never readable as raw bytes by any plugin. Cross-plugin namespace reads are rejected at the boundary, not filtered after the fact.

**Use typed state for persistence.** `saveMyState` / `loadMyState` round-trips through the Kernel: the Kernel serializes on write, then deserializes and validates against your schema on read before returning a typed object. Do not store or parse serialized payloads yourself, and treat a validation failure as a real error — never fall back to parsing a string.

```ts
await history.saveMyState('cursor', { file: 'src/index.ts', line: 42 });

const cursor = await history.loadMyState('cursor', CursorSchema);
```

**Reversal is bounded by the record.** Declared `targets` are routing hints, not authority. The ReversalEngine only reverts mutations the ledger recorded, using pre-states the ledger captured; it will not revert a path the session never touched.

For the full model — access layers, namespace isolation, reversal safety, and the forward-looking viewer contract — see [docs/architecture/HISTORY_SECURITY_MODEL.md](./docs/architecture/HISTORY_SECURITY_MODEL.md).

## Pull Request Process

1. Create a feature branch from `main`.
2. Implement your changes, following the code style and testing guidelines above.
3. Ensure the CI pipeline passes locally (`npm run ci`).
4. Submit a pull request with a clear description of the changes and their intent.
5. Maintainers will review the PR and may request changes. Please respond promptly to feedback.

## Commit Message Guidelines

Brud Code follows the **Conventional Commits** standard:

```
<type>(<scope>): <description>
```

Types include:
- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation changes
- `refactor` — Code refactoring
- `test` — Adding or updating tests
- `chore` — Build process or tooling changes

Examples:

```
feat(engine): add file rename operation to the patch engine
fix(history): correct session ID sequence generation
docs: update architecture documentation
```

This ensures the changelog can be derived directly from the commit history.