# Contributing to Brud Code

Thank you for your interest in Brud Code — a full AI-assisted coding platform for manual paste-and-apply workflows from any AI chatbot.

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
- Your environment (OS, VS Code version, extension version)

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

   This runs `npm run build:all`, `npm run test:kernel`, `npm run test:core`, `npm run test:mcp`, `npm run test:extension`, `npm run check:boundaries`, and `npm run lint`. It does not run `npm run test:integration`, `npm run test:daemon`, or `npm run test:adapter`; run those separately.

4. **For a quicker feedback loop** during development:

   ```bash
   npm run ci:quick
   ```

## Project Structure

Brud Code is organized as a monorepo with npm workspaces. Key directories:

- `packages/core/` — Core patching logic, history, and file operations (no VS Code API dependencies)
- `packages/protocol/` — Protocol definitions and data structures
- `packages/adapters/` — Platform-specific adapters (e.g., VS Code)
- `packages/ui/` — Webview-based user interface
- `apps/` — Application entry points

Refer to [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of the architecture and design decisions.

## Code Style

- **TypeScript** — All code must be written in TypeScript with strict type checking enabled.
- **Formatting** — Use the project's ESLint configuration. Run `npm run lint` before committing.
- **Atomic Changes** — Each change must be minimal and context-aware. Changes should be designed to apply as a single transaction.
- **Decoupled Core** — Core patching logic in `packages/core/` must remain free of VS Code API dependencies. Platform-specific concerns belong in the adapter layer.

## Testing Requirements

Capability projection (§1.3 R3 of the rollout plan) is only as strong as the tests that exercise it. Mocked tests pass while production fails under the same capability model: a test that never touches a real driver cannot detect a containment bug, a race, or a missing index. The repository therefore enforces production-realistic, zero-mock, adversarial testing under **D-18**, and `packages/core/` is frozen reference material under **D-17** — it is not a test target and it is scheduled for removal. New tests belong in the package that owns the surface.

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
- Any in-memory or fake implementation of a production contract outside `packages/core/`. These are the subject of the de-mocking work that follows D-18.

**Setup helpers versus substitution helpers.** A setup helper wires real implementations into a test harness and is permitted; `packages/kernel/src/__tests__/support/realKernel.ts` and `packages/kernel/src/__tests__/fixtures/kernelWorker.ts` are the canonical examples. A substitution helper replaces a production contract with an in-memory or fake implementation and is forbidden outside `packages/core/`.

**Adversarial categories and examples:**

- **Injection** — malicious `[BRUD]` blocks and parameter injection routed through the real `BrudTools` parser.
- **Replay** — replaying the same mutation against `UniversalHistory` on real SQLite.
- **Token forgery** — forged history entries and forged plugin brand or claim records.
- **Unauthorized access** — a plugin without a capability attempting the corresponding handle, and path traversal via symlink against the real `BrudFileSystem`.
- **Malformed payloads** — malformed JSON-RPC framing and malformed tool parameters against the real transports.
- **Concurrent access** — concurrent writers to the same path through `DurableNodeStorageDriver`, and concurrent history appends against real SQLite.
- **Resource exhaustion** — oversized payloads, oversized files, and batch/read ceilings against the real reader and terminal surfaces.

**Running the suite.** Run the suite that owns the surface you changed: `npm run test:core`, `npm run test:mcp`, `npm run test:daemon`, `npm run test:adapter`, or `npm run test --workspace @brud/kernel`. All tests must pass before submitting a pull request. The CI pipeline (`npm run ci`) runs `build:all`, `test:kernel`, `test:core`, `test:mcp`, `test:extension`, `check:boundaries`, and `lint`; it does not run `test:integration`, `test:daemon`, or `test:adapter`, so run those separately.

**References.** D-17 (packages/core frozen), D-18 (the standard), plan §5.5 (`docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md`), evidence base (`.internal_docs/audits/2026-11-04_test_realism_inventory.md`).

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